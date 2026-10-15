// 本体の画面：タブ、アドレスバー、ビューの切り替え、左の欄（クイックアクセス・よく使う場所）、状態の表示。
// ファイルの中身の見せ方はビュー（MOD）に任せ、ここは「どのフォルダを、どのビューで」を管理する。
import type { EntryRef, KeyMessage, MenuItem, Rect, ViewInfo } from "../api/types";
import { uniqueName } from "../core/names";
import { parseCommandLine, splitPath } from "../core/paths";
import { backend, BackendError, ICON_ORIGIN, type OneDriveAction, type Place, type RawEntry, type RawFolder } from "./backend";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { moveItem } from "../core/drop";
import { pairChanges, type RawChange } from "../core/changes";
import { DragController, type WindowTarget } from "./drag";
import { confirmDialog, playOpen, playTrash } from "./effects";
import { showMenu, type MenuLine } from "./menu";
import type { ModProblem } from "./mods";
import { slotPicker, tagPicker } from "./pickers";
import { ModManager } from "./mod-manager";
import { loadViews } from "./mods";
import { quickAccess, recentItems } from "./ref-list-service";
import { timetableService } from "./timetable-service";
import { ViewHost, type LoadedView, type TabActions } from "./view-host";

const DEFAULT_VIEW_ID = "builtin.win11";
const HOME_VIEW_ID = "builtin.home";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function currentTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** フォルダと関係するビューか（manifest の location。ADR 0014 判断1） */
const isFolderView = (v: LoadedView) => (v.manifest.location ?? "folder") === "folder";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** フォルダのパスを比べるための形（Windows のパスは大文字・小文字を区別しない。末尾の \ も無視する） */
const folderKey = (path: string) => path.replace(/\\+$/, "").toLowerCase();

let tabCounter = 0;

class Tab implements TabActions {
  readonly tabId = `tab-${++tabCounter}`;
  readonly pane = el("div", "view-pane");
  readonly button = el("div", "tab");
  private readonly label = el("span", "tab-label", "…");
  private readonly badge = el("span", "tab-view");
  folder: RawFolder | null = null;
  back: string[] = [];
  forward: string[] = [];
  readonly host: ViewHost;

  constructor(
    private readonly app: App,
    readonly view: LoadedView,
  ) {
    // バツの逆側の ▸：押すと、このタブのビューを選び直すメニューが出る（ADR 0017）
    const views = el("button", "tab-views", "▸");
    views.title = "ビューを変える";
    views.onclick = (e) => {
      e.stopPropagation();
      void app.chooseView(this, views);
    };
    const close = el("button", "tab-close", "×");
    close.title = "タブを閉じる (Ctrl+W)";
    close.onclick = (e) => {
      e.stopPropagation();
      app.closeTab(this);
    };
    if (isFolderView(view)) {
      // 標準以外のビューのタブには、ビューの名前を小さく出す（同じフォルダを別のビューで並べたとき見分けるため）
      this.badge.textContent = view.manifest.id === DEFAULT_VIEW_ID ? "" : view.manifest.name;
    } else {
      // フォルダと関係ないビュー（ホーム・タグなど）は、タブの名前をビューの名前にする
      this.label.textContent = view.manifest.name;
      this.button.title = view.manifest.name;
    }
    // ホーム・タグなど、場所と関係ないビューのタブには ▸ を出さない（切り替える先が無いため）
    this.button.append(...(isFolderView(view) ? [views] : []), this.label, this.badge, close);
    this.button.onclick = () => app.activate(this);
    this.button.onauxclick = (e) => e.button === 1 && app.closeTab(this);
    this.host = new ViewHost(this.pane, view, this);
  }

  get folderView(): boolean {
    return isFolderView(this.view);
  }

  setFolder(folder: RawFolder) {
    this.folder = folder;
    this.label.textContent = folder.name;
    this.button.title = `${folder.path}\n${this.view.manifest.name}`;
    this.host.setFolder(folder);
  }

  destroy() {
    this.host.destroy();
    this.pane.remove();
    this.button.remove();
  }

  // ---- TabActions（ビューから頼まれること） ----
  theme = currentTheme;
  navigate = (path: string) => this.app.navigate(this, path);
  navigateUp = async () => {
    if (this.folder?.parentPath) await this.app.navigate(this, this.folder.parentPath);
  };
  open = (ref: EntryRef, from?: Rect, newTab?: boolean) => this.app.open(this, ref, from, newTab);
  trash = (refs: EntryRef[], from?: Rect) => this.app.trash(this, refs, from);
  rename = (ref: EntryRef, newName: string) => this.app.rename(this, ref, newName);
  createFolder = (name?: string) => this.app.createFolder(this, name);
  showMenu = (x: number, y: number, items: EntryRef[], extra: MenuItem[]) => this.app.showMenu(this, x, y, items, extra);
  shortcut = (key: KeyMessage) => this.app.handleKey(key);
  listViews = () => this.app.viewInfos();
  get mods() {
    return this.app.mods;
  }
  openTab = (viewId: string, path?: string, replace?: boolean) => this.app.openTabById(this, viewId, path, replace);
  clipboardSet = (items: EntryRef[], cut: boolean) =>
    backend.clipboardSet(items, cut).catch((e) => {
      this.app.notify(`${cut ? "切り取り" : "コピー"}できませんでした：${errorText(e)}`);
      throw e;
    });
  clipboardPaste = () => this.app.paste(this);
  dragStart = (items: EntryRef[], x: number, y: number, targets: WindowTarget[]) => this.app.drag.start(this.tabId, items, x, y, targets);
  dragTargets = (targets: WindowTarget[]) => this.app.drag.setTargets(this.tabId, targets);
  dragMove = (x: number, y: number, ctrl: boolean, shift: boolean) => this.app.drag.move(x, y, ctrl, shift);
  dragEnd = (x: number, y: number, ctrl: boolean, shift: boolean, cancel: boolean) => this.app.drag.end(x, y, ctrl, shift, cancel);
}

export class App {
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private readonly tabStrip = el("div", "tab-strip");
  private readonly navRow = el("div", "nav-row");
  private readonly addressBar = el("div", "address-bar");
  private readonly crumbs = el("div", "crumbs");
  private readonly address = el("input", "address");
  private readonly sidebar = el("nav", "sidebar");
  private readonly quickList = el("div", "quick-list");
  private readonly content = el("main", "content");
  private readonly status = el("footer", "status");
  private readonly backBtn = el("button", "nav-btn", "←");
  private readonly forwardBtn = el("button", "nav-btn", "→");
  private readonly upBtn = el("button", "nav-btn", "↑");
  private readonly refreshBtn = el("button", "nav-btn", "⟳");

  constructor(
    private views: LoadedView[],
    private problems: ModProblem[],
    private readonly places: Place[],
    /** 最初に開くフォルダ（開発中に、試験用のフォルダで起動するため。ふだんは null） */
    private readonly startDir: string | null = null,
  ) {}

  // ---- MOD の管理（ADR 0020） ----

  readonly mods = new ModManager({
    views: () => this.views,
    problems: () => this.problems,
    reloadViews: (dirs) => this.reloadViews(dirs ?? []),
    openFolder: (path) => void this.openTab(this.defaultView(), path),
    toast: (m) => this.toast(m),
  });

  /**
   * MOD の一覧を読み直す。なくなった MOD のタブは標準のビューにし、reloadDirs のフォルダの MOD（保存された開発中の MOD）や、
   * 版の変わった MOD を使っているタブは、ビューを作り直す（フォルダと履歴はそのまま）
   */
  private async reloadViews(reloadDirs: string[]) {
    const { views, problems } = await loadViews();
    if (views.length === 0) return;
    this.views = views;
    this.problems = problems;
    const reload = new Set(reloadDirs.map(folderKey));
    for (const tab of [...this.tabs]) {
      const next = views.find((v) => v.manifest.id === tab.view.manifest.id);
      if (!next) {
        // 外した MOD のタブは、フォルダを見るビューなら標準のビュー、そうでなければホームにする
        const home = views.find((v) => v.manifest.id === HOME_VIEW_ID);
        await this.changeView(tab, isFolderView(tab.view) || !home ? this.defaultView() : home, true);
      }
      else if (reload.has(folderKey(next.dir)) || next.dir !== tab.view.dir || next.manifest.version !== tab.view.manifest.version) {
        await this.changeView(tab, next, true);
      }
    }
  }

  // ---- ドラッグ＆ドロップ（ADR 0015 判断2） ----

  readonly drag = new DragController({
    tabs: () =>
      this.tabs.map((t) => ({ id: t.tabId, button: t.button, folder: t.folderView ? (t.folder?.path ?? null) : null, pane: t.pane, active: t === this.active })),
    activateTab: (id) => {
      const t = this.tabs.find((x) => x.tabId === id);
      if (t) this.activate(t, false);
    },
    requestTargets: (id) => this.tabs.find((x) => x.tabId === id)?.host.requestDragTargets(),
    keepAlive: (pane) => {
      for (const t of this.tabs) t.pane.classList.toggle("drag-keep", t.pane === pane);
    },
    cursorOverApp: () => backend.cursorOverApp(),
    dragOut: async (items) => {
      try {
        // マウスが本体の外へ出た。ここから先は Windows のドラッグ（落とされるまで戻らない）
        const result = await backend.dragOut(items);
        if (result === "dropped") this.refreshAll();
      } catch (e) {
        this.toast(`ドラッグできませんでした：${errorText(e)}`);
      }
    },
    drop: async (items, dest, effect) => {
      try {
        // ファイルID が空なのは、アプリの外から落とされたもの（パスは Windows が渡したもの）
        if (items.length > 0 && items.every((i) => i.id === "")) await backend.transferPaths(items.map((i) => i.path), dest, effect);
        else await backend.transfer(items, dest, effect);
      } catch (e) {
        if (!(e instanceof BackendError && e.apiError.code === "denied")) this.toast(`${effect === "move" ? "移動" : "コピー"}できませんでした：${errorText(e)}`);
      }
      this.refreshAll();
    },
  });

  /** 貼り付け（ADR 0015 判断1）。今のフォルダへ */
  async paste(tab: Tab): Promise<number> {
    if (!tab.folderView || !tab.folder) throw new BackendError({ code: "not-found", message: "no folder is open" });
    try {
      return await backend.clipboardPaste(tab.folder.path);
    } catch (e) {
      if (!(e instanceof BackendError && e.apiError.code === "denied")) this.notify(`貼り付けできませんでした：${errorText(e)}`);
      throw e;
    } finally {
      this.refreshAll();
    }
  }

  /** 画面の下に短いお知らせを出す */
  notify(message: string) {
    this.toast(message);
  }

  /** ファイルの移動・コピーの後、フォルダを開いているタブをすべて読み直す（移動元と移動先のどちらも新しくなるように） */
  private refreshAll() {
    for (const t of this.tabs) if (t.folderView && t.folder) void this.navigate(t, t.folder.path, false).catch(() => {});
  }

  // ---- フォルダの見張り（ADR 0018）：ほかのアプリでファイルが変わったら、そのフォルダを開いているタブを読み直す ----

  /** 見張るフォルダ（タブで開いているフォルダ）を Rust に伝える。同じなら伝え直さない */
  private watched = "";
  private syncWatch() {
    const paths = [...new Set(this.tabs.filter((t) => t.folderView && t.folder).map((t) => t.folder!.path))].sort();
    const key = paths.join("\n");
    if (key === this.watched) return;
    this.watched = key;
    void backend.watchFolders(paths).catch(() => {});
  }

  /** 知らせはまとめて来る（コピー中など）ので、少し待ってから1回だけ読み直す */
  private changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** まだビューに知らせていない、フォルダごとの1件ずつの変化 */
  private pendingChanges = new Map<string, RawChange[]>();
  private onFolderChanged(path: string) {
    const key = folderKey(path);
    clearTimeout(this.changeTimers.get(key));
    this.changeTimers.set(
      key,
      setTimeout(() => {
        this.changeTimers.delete(key);
        const changes = pairChanges(this.pendingChanges.get(key) ?? []);
        this.pendingChanges.delete(key);
        for (const t of this.tabs) {
          if (t.folderView && t.folder && folderKey(t.folder.path) === key) {
            void this.navigate(t, t.folder.path, false).then(() => t.host.pushChanges(changes), () => {});
          }
        }
      }, 300),
    );
  }

  mount(root: HTMLElement) {
    document.documentElement.dataset.theme = currentTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      document.documentElement.dataset.theme = currentTheme();
      for (const t of this.tabs) t.host.setTheme(currentTheme());
    });

    const newTab = el("button", "tab-new", "+");
    newTab.title = "新しいタブ (Ctrl+T)";
    newTab.onclick = () => void this.openHome();
    const tabsRow = el("div", "tabs-row");
    tabsRow.append(this.tabStrip, newTab);

    this.backBtn.title = "戻る (Alt+←)";
    this.forwardBtn.title = "進む (Alt+→)";
    this.upBtn.title = "上のフォルダへ (Alt+↑)";
    this.refreshBtn.title = "読み直す (F5)";
    this.backBtn.onclick = () => this.goBack();
    this.forwardBtn.onclick = () => this.goForward();
    this.upBtn.onclick = () => this.active && void this.active.navigateUp();
    this.refreshBtn.onclick = () => this.refresh();
    this.mountAddressBar();
    this.navRow.append(this.backBtn, this.forwardBtn, this.upBtn, this.refreshBtn, this.addressBar, this.nowBtn);
    this.startNowWatch();

    this.renderSidebar();
    quickAccess.onChange(() => void this.renderQuickAccess());
    const body = el("div", "body");
    body.append(this.sidebar, this.content);
    root.append(tabsRow, this.navRow, body, this.status);

    // ブラウザ本来の右クリックのメニュー（戻る・印刷・開発者ツールなど）は出さない。アドレスバーなどの入力欄だけは残す
    document.addEventListener("contextmenu", (e) => {
      if (!(e.target instanceof Element && e.target.closest("input, textarea"))) e.preventDefault();
    });

    // ブラウザ本来のドラッグ（画像・文字・リンクをつかんで動かす）は止める。アプリのドラッグ＆ドロップとぶつかるため
    document.addEventListener("dragstart", (e) => {
      if (!(e.target instanceof Element && e.target.closest("input, textarea"))) e.preventDefault();
    });

    // ドラッグ中、マウスが本体の画面（タブ・アドレスバーなど）に来たときの動きも追う。
    // ふだんはビューのランタイムが送ってくるが、ビューの外でボタンを離したときなどに、こちらで受け取る
    document.addEventListener("pointermove", (e) => this.drag.active && this.drag.move(e.clientX, e.clientY, e.ctrlKey, e.shiftKey));
    document.addEventListener("pointerup", (e) => this.drag.active && void this.drag.end(e.clientX, e.clientY, e.ctrlKey, e.shiftKey, false));
    void listen<string>("folder-changed", (e) => this.onFolderChanged(e.payload));
    // 1件ずつの変化は、読み直しのあとでビューに知らせる（MOD のアニメーション用。ADR 0023）
    void listen<RawChange & { folder: string }>("folder-change", (e) => {
      const key = folderKey(e.payload.folder);
      const list = this.pendingChanges.get(key) ?? [];
      list.push(e.payload);
      this.pendingChanges.set(key, list);
    });
    // アプリの窓に戻ってきたら、時間割を読み直す（別の PC で書き換えて、OneDrive などの同期で届いたとき。ADR 0022）
    let lastRefresh = 0;
    window.addEventListener("focus", () => {
      if (Date.now() - lastRefresh < 5000) return;
      lastRefresh = Date.now();
      void timetableService.refresh();
    });
    // 開発中の MOD のフォルダが保存されたら、その MOD を読み直す（ホットリロード。ADR 0020）
    void listen<string>("mod-changed", (e) => this.mods.devChanged(e.payload));

    // 普通のエクスプローラなど、アプリの外からファイルをドラッグしてきたとき（ADR 0016）。
    // 位置は画面の実際の点の数で来るので、画面の倍率で割って、本体の画面の座標にする
    void getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "leave") return this.drag.cancel();
      const x = p.position.x / window.devicePixelRatio;
      const y = p.position.y / window.devicePixelRatio;
      // ホームなど、フォルダと関係ないタブに MOD の zip を落としたら、MOD を入れる（ADR 0020）
      const zips = p.type === "enter" || p.type === "drop" ? p.paths.every((x) => /\.zip$/i.test(x)) : false;
      const modDrop = zips && this.active !== null && !this.active.folderView;
      if (p.type === "enter") {
        if (!modDrop) this.active && this.drag.startExternal(this.active.tabId, p.paths, x, y);
      } else if (p.type === "over") this.drag.move(x, y, false, false);
      else if (p.type === "drop") {
        if (modDrop) {
          this.drag.cancel();
          void (async () => {
            for (const z of p.paths) await this.mods.installZip(z);
          })();
        } else void this.drag.end(x, y, false, false, false);
      }
    });

    document.addEventListener("keydown", (e) => this.drag.active && e.key === "Escape" && void this.drag.end(0, 0, false, false, true));

    document.addEventListener("keydown", (e) => {
      // F5・Ctrl+R はブラウザの再読み込みを止めて、フォルダの読み直しにする
      if (e.key === "F5" || (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        this.refresh();
        return;
      }
      if (e.ctrlKey || e.altKey) {
        if (this.handleKey({ ep: 1, kind: "key", key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
      }
    });

    for (const p of this.problems) console.warn(`MOD を読み込めませんでした: ${p.dir}\n${p.errors.join("\n")}`);
    if (this.problems.length > 0) this.toast(`読み込めない MOD が ${this.problems.length} 個あります（詳細は開発者ツールのコンソール）`);
    // 起動したらホームを開く（開発中に試験用のフォルダを指定したときは、そのフォルダ）
    if (this.startDir) void this.openTab(this.defaultView(), this.startDir);
    else void this.openHome();
  }

  private homePath(): string {
    return (
      this.startDir ??
      this.places.find((p) => p.kind === "documents")?.path ??
      this.places.find((p) => p.kind === "home")?.path ??
      "C:\\"
    );
  }

  // ---- アドレスバー（ADR 0014 判断5）：区切りごとに押せる。空いている所を押すと入力。コマンドも起動できる ----

  private mountAddressBar() {
    this.address.spellcheck = false;
    this.address.hidden = true;
    this.addressBar.title = "場所 (Ctrl+L)。cmd・powershell などのコマンドも入れられます";
    this.addressBar.append(this.crumbs, this.address);
    this.addressBar.onclick = (e) => {
      if (e.target === this.addressBar || e.target === this.crumbs) this.editAddress();
    };
    this.address.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submitAddress(this.address.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.endEditAddress();
        this.active?.host.focus();
      }
    };
    this.address.onblur = () => this.endEditAddress();
  }

  private renderCrumbs() {
    this.crumbs.textContent = "";
    const path = this.active?.folder?.path;
    if (!path) return;
    const parts = splitPath(path);
    parts.forEach((c, i) => {
      if (i > 0) this.crumbs.append(el("span", "crumb-sep", "›"));
      const b = el("button", "crumb", c.label);
      b.title = c.path;
      b.dataset.dropPath = c.path; // ドラッグ＆ドロップで、ここへ落とせる
      b.onclick = (e) => {
        e.stopPropagation();
        if (this.active) void this.navigate(this.active, c.path).catch(() => {});
      };
      this.crumbs.append(b);
    });
    // 深い場所でも、今いる所（右端）が見えるように
    this.crumbs.scrollLeft = this.crumbs.scrollWidth;
  }

  private editAddress() {
    const t = this.active;
    if (!t?.folderView) return;
    this.crumbs.hidden = true;
    this.address.hidden = false;
    this.address.value = t.folder?.path ?? "";
    this.address.focus();
    this.address.select();
  }

  private endEditAddress() {
    this.address.hidden = true;
    this.crumbs.hidden = false;
  }

  /** フォルダなら移動、ファイルなら開く、どちらでもなければコマンドとして今のフォルダで起動する */
  private async submitAddress(text: string) {
    const t = this.active;
    const value = text.trim().replace(/^"(.*)"$/, "$1");
    if (!t || !value) return this.endEditAddress();
    const kind = await backend.pathKind(value).catch(() => "none" as const);
    try {
      if (kind === "dir") {
        await this.navigate(t, value);
      } else if (kind === "file") {
        const [id] = await backend.fileIds([value]);
        await this.open(t, { id, path: value });
      } else {
        const cmd = parseCommandLine(text);
        if (!cmd) return;
        await backend.runCommand(cmd.file, cmd.args, t.folder?.path ?? "").catch(() => {
          throw new Error(`「${value}」というフォルダ・ファイル・コマンドは見つかりません`);
        });
      }
      this.endEditAddress();
      t.host.focus();
    } catch (e) {
      if (!(e instanceof BackendError)) this.toast(errorText(e));
    }
  }

  // ---- 左の欄：クイックアクセス（ADR 0014 判断3）と、よく使う場所 ----

  private renderSidebar() {
    // ユーザーのフォルダ（kind: home）は、上の「⌂ ホーム」（ホームの画面）と紛らわしくないよう、Win11 と同じくフォルダの名前で出す
    const labels: Record<string, string> = {
      desktop: "デスクトップ",
      documents: "ドキュメント",
      downloads: "ダウンロード",
      pictures: "ピクチャ",
      music: "ミュージック",
      videos: "ビデオ",
    };
    const homeBtn = el("button", "place place-home-view", "⌂ ホーム");
    homeBtn.onclick = () => void this.openHome(true);
    this.sidebar.append(homeBtn, el("div", "side-head", "クイックアクセス"), this.quickList, el("div", "side-head", "場所"));
    for (const p of this.places) {
      const b = el("button", `place place-${p.kind}`);
      // Win11 と同じく、Windows が使っている絵（デスクトップ・ダウンロード・ドライブなど）を添える
      const icon = el("img", "place-icon");
      icon.src = `${ICON_ORIGIN}/place/${p.kind === "drive" ? `drive-${p.name.replace(/:$/, "")}` : p.kind}?size=16`;
      icon.alt = "";
      b.append(icon, el("span", undefined, p.kind === "drive" ? `ドライブ ${p.name}` : (labels[p.kind] ?? p.name)));
      b.title = p.path;
      b.dataset.dropPath = p.path;
      b.onclick = () => void this.goTo(p.path);
      this.sidebar.appendChild(b);
    }
    void this.renderQuickAccess();
  }

  private async renderQuickAccess() {
    const items = await quickAccess.entries().catch(() => [] as RawEntry[]);
    this.quickList.textContent = "";
    if (items.length === 0) {
      this.quickList.append(el("div", "side-empty", "フォルダを右クリック →「クイックアクセスにピン留め」"));
      return;
    }
    for (const r of items) {
      const b = el("button", "place place-quick");
      const icon = el("img", "place-icon");
      icon.src = `${ICON_ORIGIN}/ext/folder?size=16`;
      icon.alt = "";
      b.append(icon, el("span", undefined, r.name));
      b.title = r.path;
      b.dataset.dropPath = r.path;
      b.onclick = () => void this.goTo(r.path);
      b.oncontextmenu = (e) => {
        e.preventDefault();
        const ref = { id: r.id, path: r.path };
        void showMenu(e.clientX, e.clientY, [
          { label: "開く", run: () => void this.goTo(r.path) },
          { label: "新しいタブで開く", run: () => void this.openTab(this.defaultView(), r.path) },
          "separator",
          { label: "クイックアクセスから外す", run: () => quickAccess.unpin([ref]) },
        ]);
      };
      this.quickList.append(b);
    }
  }

  /** 左の欄などからフォルダへ行く。今のタブがフォルダと関係ないビュー（ホームなど）なら、そのタブを標準のビューに置き換える */
  private async goTo(path: string) {
    const t = this.active;
    if (!t) return;
    if (t.folderView) await this.navigate(t, path).catch(() => {});
    else await this.replaceTab(t, this.defaultView(), path);
  }

  // ---- タブ ----

  private defaultView(): LoadedView {
    return this.views.find((v) => v.manifest.id === DEFAULT_VIEW_ID) ?? this.views[0];
  }

  viewInfos(): ViewInfo[] {
    return this.views.map((v) => ({
      id: v.manifest.id,
      name: v.manifest.name,
      ...(v.manifest.description !== undefined ? { description: v.manifest.description } : {}),
      location: v.manifest.location ?? "folder",
    }));
  }

  /** 新しいタブをホームで開く（ホームのビューが無ければ、標準のビューでよく使う場所を開く）。replace なら今のタブを置き換える */
  private async openHome(replace = false) {
    const home = this.views.find((v) => v.manifest.id === HOME_VIEW_ID);
    if (!home) return this.openTab(this.defaultView(), this.homePath());
    if (replace && this.active) return this.replaceTab(this.active, home);
    return this.openTab(home);
  }

  /** view のタブを開く。フォルダと関係するビューなら path（無ければよく使う場所）へ移動する。at はタブの並びの位置 */
  async openTab(view: LoadedView, path?: string, at?: number) {
    const tab = new Tab(this, view);
    this.enableTabReorder(tab);
    const i = at ?? this.tabs.length;
    this.tabs.splice(i, 0, tab);
    this.tabStrip.insertBefore(tab.button, this.tabStrip.children[i] ?? null);
    this.content.appendChild(tab.pane);
    this.activate(tab);
    if (tab.folderView) await this.navigate(tab, path ?? this.homePath(), false).catch(() => {});
    return tab;
  }

  /** タブを、別のビュー（とフォルダ）で置き換える（ホームから開くとき。Win11 と同じく、ホームのタブがそのフォルダになる） */
  private async replaceTab(old: Tab, view: LoadedView, path?: string) {
    const i = this.tabs.indexOf(old);
    await this.openTab(view, path, i < 0 ? undefined : i);
    this.tabs = this.tabs.filter((t) => t !== old);
    old.destroy();
    this.syncWatch();
  }

  /** タブの ▸ から、そのタブのビューを選び直す（ADR 0017）。新しいタブは開かず、今のタブのまま見せ方を変える */
  async chooseView(tab: Tab, anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    await showMenu(
      r.left,
      r.bottom + 2,
      // 選べるのは、フォルダを見るビューだけ（ホーム・タグは場所と関係ないので、ここでは選ばない）
      this.views.filter(isFolderView).map((v) => ({
        label: `${v === tab.view ? "● " : "　 "}${v.manifest.name}`,
        run: () => void this.changeView(tab, v),
      })),
    );
  }

  /** タブのビューを変える。フォルダと履歴（戻る・進む）はそのまま引き継ぐ */
  /** force：同じビューでも作り直す（MOD を読み直すとき）。表示していないタブのビューを変えても、表示中のタブはそのまま */
  private async changeView(tab: Tab, view: LoadedView, force = false) {
    if (!force && view.manifest.id === tab.view.manifest.id) return;
    const path = isFolderView(view) ? (tab.folder?.path ?? this.homePath()) : undefined;
    const i = this.tabs.indexOf(tab);
    const shown = this.active;
    const next = await this.openTab(view, path, i < 0 ? undefined : i);
    if (shown && shown !== tab) this.activate(shown, false);
    next.back = tab.back;
    next.forward = tab.forward;
    this.tabs = this.tabs.filter((t) => t !== tab);
    tab.destroy();
    this.updateChrome();
    this.syncWatch();
  }

  /** ビューから頼まれた tabs.open */
  async openTabById(from: Tab, viewId: string, path?: string, replace = false) {
    const view = this.views.find((v) => v.manifest.id === viewId);
    if (!view) throw new BackendError({ code: "not-found", message: `view ${viewId}` });
    const target = isFolderView(view) ? (path ?? from.folder?.path ?? this.homePath()) : undefined;
    if (replace) await this.replaceTab(from, view, target);
    else await this.openTab(view, target);
  }

  closeTab(tab: Tab) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    if (this.tabs.length === 1) {
      // 最後のタブは閉じずに残す（空の画面にしない）
      return;
    }
    this.tabs.splice(i, 1);
    tab.destroy();
    this.syncWatch();
    if (this.active === tab) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]);
  }

  activate(tab: Tab, focus = true) {
    this.active = tab;
    for (const t of this.tabs) {
      const on = t === tab;
      t.button.classList.toggle("active", on);
      t.pane.classList.toggle("active", on);
    }
    this.endEditAddress();
    this.updateChrome();
    if (focus) tab.host.focus();
  }

  // ---- タブの並べ替え（ADR 0015 判断3）：ドラッグすると、まわりのタブが滑らかに避ける ----

  private enableTabReorder(tab: Tab) {
    const b = tab.button;
    b.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || (down.target as HTMLElement).closest(".tab-close, .tab-views")) return;
      const startX = down.clientX;
      const from = this.tabs.indexOf(tab);
      const rects = this.tabs.map((t) => t.button.getBoundingClientRect());
      let moving = false;
      let to = from;
      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        if (!moving && Math.abs(dx) < 5) return;
        if (!moving) {
          moving = true;
          b.setPointerCapture(down.pointerId);
          b.classList.add("tab-dragging");
        }
        b.style.transform = `translateX(${dx}px)`;
        // 動かしているタブの真ん中が、ほかのタブの真ん中を越えたら、そのタブを1つ分ずらす
        const center = rects[from].x + rects[from].width / 2 + dx;
        to = from;
        rects.forEach((r, i) => {
          if (i === from) return;
          const mid = r.x + r.width / 2;
          if (i > from && center > mid) to = Math.max(to, i);
          if (i < from && center < mid) to = Math.min(to, i);
        });
        this.tabs.forEach((t, i) => {
          if (i === from) return;
          const shift = from < to && i > from && i <= to ? -rects[from].width - 2 : from > to && i < from && i >= to ? rects[from].width + 2 : 0;
          t.button.style.transform = shift ? `translateX(${shift}px)` : "";
        });
      };
      const onUp = () => {
        b.removeEventListener("pointermove", onMove);
        b.removeEventListener("pointerup", onUp);
        b.removeEventListener("pointercancel", onUp);
        if (!moving) return;
        b.classList.remove("tab-dragging");
        // 並べ替えたあとは、ずらしたぶんを外し、本当の位置に入れ直す
        for (const t of this.tabs) t.button.style.transform = "";
        if (to !== from) {
          this.tabs = moveItem(this.tabs, from, to);
          for (const t of this.tabs) this.tabStrip.appendChild(t.button);
        }
      };
      b.addEventListener("pointermove", onMove);
      b.addEventListener("pointerup", onUp);
      b.addEventListener("pointercancel", onUp);
    });
  }

  private updateChrome() {
    const t = this.active;
    // フォルダと関係ないビューのタブでは、アドレスバーと戻る・進むを隠す（ADR 0014 判断1）
    this.navRow.classList.toggle("no-location", !!t && !t.folderView);
    this.renderCrumbs();
    this.backBtn.disabled = !t || t.back.length === 0;
    this.forwardBtn.disabled = !t || t.forward.length === 0;
    this.upBtn.disabled = !t?.folder?.parentPath;
    this.status.textContent = t?.folderView && t.folder ? `${t.folder.entries.length} 個の項目` : "";
    document.title = t?.folder ? `${t.folder.name} - explorer_plus` : t ? `${t.view.manifest.name} - explorer_plus` : "explorer_plus";
  }

  async navigate(tab: Tab, path: string, record = true) {
    let folder: RawFolder;
    try {
      folder = await backend.listDir(path);
    } catch (e) {
      const msg = e instanceof BackendError && e.apiError.code === "not-found" ? `フォルダが見つかりません：${path}` : `開けませんでした：${path}`;
      this.toast(msg);
      throw e;
    }
    if (record && tab.folder && tab.folder.path !== folder.path) {
      tab.back.push(tab.folder.path);
      tab.forward = [];
    }
    tab.setFolder(folder);
    // 別の PC で作った時間割（フォルダの中のファイル）があれば見つける（ADR 0022）
    void timetableService.discover({ id: folder.id, path: folder.path });
    if (tab === this.active) this.updateChrome();
    this.syncWatch();
  }

  private async goBack() {
    const t = this.active;
    const prev = t?.back.pop();
    if (!t || !prev) return;
    if (t.folder) t.forward.push(t.folder.path);
    await this.navigate(t, prev, false);
  }

  private async goForward() {
    const t = this.active;
    const next = t?.forward.pop();
    if (!t || !next) return;
    if (t.folder) t.back.push(t.folder.path);
    await this.navigate(t, next, false);
  }

  refresh() {
    const t = this.active;
    if (t?.folderView && t.folder) void this.navigate(t, t.folder.path, false);
  }

  /** newTab：フォルダを、今のタブではなく新しいタブ（標準のビュー）で開く（タグビュー・時間割ビューから開くとき） */
  async open(tab: Tab, ref: EntryRef, from?: Rect, newTab = false) {
    let target = ref;
    let isDir = tab.folder?.entries.find((e) => e.path === ref.path)?.isDir;
    if (isDir === undefined) {
      // 今のフォルダに無いもの（リンクで指しているものなど）は、ID から探す。移動していれば今の場所を使う
      const [found] = await backend.resolve([ref]);
      if (!found) throw new BackendError({ code: "not-found", message: ref.path });
      isDir = found.isDir;
      target = { id: found.id, path: found.path };
    }
    if (isDir) {
      if (newTab || !tab.folderView) await this.openTab(this.defaultView(), target.path);
      else await this.navigate(tab, target.path);
      return;
    }
    playOpen(from);
    await backend.openEntry(target);
    // 開いたファイルを「最近使った項目」に残す（ホームで出す。ADR 0014 判断2）
    recentItems.push(target);
  }

  // ---- 今の授業（ADR 0010・0012。すべての時間割から。どのビューを開いていても、アドレスバーの横に出す） ----

  private readonly nowBtn = el("button", "now-class");

  private async updateNow() {
    const all = await timetableService.allNow().catch(() => []);
    const first = all[0];
    this.nowBtn.hidden = !first;
    if (!first) return;
    const name = (c: (typeof all)[number]) => c.slot.title || c.period.label;
    this.nowBtn.textContent = `今：${name(first)}${all.length > 1 ? ` ほか${all.length - 1}` : ""}`;
    const hasFolder = all.some((c) => c.slot.folders[0]);
    this.nowBtn.classList.toggle("no-folder", !hasFolder);
    this.nowBtn.title = all.map((c) => `${name(c)}（${c.folder.path.split("\\").pop()}）`).join("\n");
    this.nowBtn.onclick = (e) => {
      const openClass = (c: (typeof all)[number]) => {
        const f = c.slot.folders[0];
        if (!f) return this.toast(`「${name(c)}」にはフォルダが結びついていません。時間割ビューで結びつけられます`);
        // 今のタブは壊さず、新しいタブで開く（ADR 0009 判断3）
        if (this.active) void this.open(this.active, f, undefined, true).catch(() => this.toast(`フォルダが見つかりません：${f.path}`));
      };
      if (all.length === 1) return openClass(first);
      // 2つの学校の授業が重なっているときは、選んでもらう
      const r = this.nowBtn.getBoundingClientRect();
      void showMenu(r.x, r.bottom + 4, all.map((c) => ({ label: `${name(c)}（${c.folder.path.split("\\").pop()}）`, run: () => openClass(c) })));
      e.stopPropagation();
    };
  }

  private startNowWatch() {
    this.nowBtn.hidden = true;
    void this.updateNow();
    timetableService.onChange(() => void this.updateNow());
    setInterval(() => void this.updateNow(), 30_000);
  }

  // ---- ファイルの操作 ----

  async trash(tab: Tab, refs: EntryRef[], from?: Rect): Promise<number> {
    const names = refs.map((r) => r.path.split("\\").pop() ?? r.path);
    const message = refs.length === 1 ? `「${names[0]}」をごみ箱へ送りますか？` : `${refs.length} 個の項目をごみ箱へ送りますか？`;
    // もう一度 Delete を押しても「ごみ箱へ送る」になる（Delete を2回で消せる）
    if (!(await confirmDialog(message, "ごみ箱へ送る", "Delete"))) {
      throw new BackendError({ code: "denied", message: "cancelled by user" });
    }
    playTrash(from);
    const n = await backend.trashEntries(refs);
    if (tab.folder) await this.navigate(tab, tab.folder.path, false);
    return n;
  }

  async rename(tab: Tab, ref: EntryRef, newName: string): Promise<RawEntry> {
    const raw = await backend.renameEntry(ref, newName);
    if (tab.folder) await this.navigate(tab, tab.folder.path, false);
    return raw;
  }

  /** 今のフォルダに新しいフォルダを作り、ビューに名前の変更を始めてもらう。name が無ければ重ならない「新しいフォルダー」 */
  async createFolder(tab: Tab, name?: string): Promise<RawEntry> {
    if (!tab.folder) throw new BackendError({ code: "not-found", message: "no folder is open" });
    const raw = await backend.createFolder(tab.folder.path, name ?? uniqueName("新しいフォルダー", tab.folder.entries.map((e) => e.name)));
    await this.navigate(tab, tab.folder.path, false);
    if (name === undefined) tab.host.requestRename(raw);
    return raw;
  }

  // ---- 圧縮・展開（ADR 0021）。7-Zip に任せる（進み具合・取りやめ・パスワードは 7-Zip の画面が出す）。できたものはフォルダの見張りで画面に出る ----

  private async compress(items: EntryRef[], format: "zip" | "7z") {
    const path = await backend.archiveCreate(items, format);
    this.toast(`圧縮しました：${path.split("\\").pop()}`);
  }

  private async extract(item: EntryRef) {
    const path = await backend.archiveExtract(item);
    this.toast(`展開しました：${path.split("\\").pop()}`);
  }

  /** 右クリックのメニュー（ADR 0009 判断2）。MOD が足した項目が選ばれたら、その id を返す */
  async showMenu(tab: Tab, x: number, y: number, items: EntryRef[], extra: MenuItem[]): Promise<string | null> {
    let chosen: string | null = null;
    const raws = items.map((r) => tab.folder?.entries.find((e) => e.path === r.path));
    const run = (work: () => Promise<unknown>) => () =>
      void work().catch((e) => {
        if (!(e instanceof BackendError && e.apiError.code === "denied")) this.toast(`できませんでした：${errorText(e)}`);
      });
    const copyPaths = (paths: string[]) => run(() => navigator.clipboard.writeText(paths.map((p) => `"${p}"`).join("\r\n")));
    const lines: MenuLine[] = [];
    if (items.length > 0) {
      const allFolders = raws.every((r) => r?.isDir);
      const single = items.length === 1 ? items[0] : null;
      const pinned = single ? quickAccess.has(single) : false;
      // OneDrive の中なら、OneDrive の操作を出す。中身は Windows のメニューの項目を呼ぶ（画面は OneDrive が出す。ADR 0016）
      const onedrive = single ? await backend.onedriveContains(single).catch(() => false) : false;
      // 圧縮・展開は 7-Zip が入っているときだけ出す（ADR 0021）
      const sevenZip = await backend.archiveTool().catch(() => ({ available: false, extensions: [] as string[] }));
      const name = raws[0]?.name.toLowerCase() ?? "";
      const archive = sevenZip.available && single !== null && raws[0] !== undefined && !raws[0].isDir && sevenZip.extensions.some((x) => name.endsWith(`.${x}`));
      const od = (label: string, action: OneDriveAction) => ({ label, run: run(() => backend.onedriveAction(single!, action)) });
      lines.push(
        // 「開く」はメニューに出さない（ダブルクリック・Enter で足りる。ADR 0015 判断5）。「プログラムから開く」はファイルのときだけ
        ...(single && raws[0] && !raws[0].isDir ? [{ label: "プログラムから開く…", run: run(() => backend.openWith(single)) }] : []),
        { label: "新しいタブで開く", disabled: !allFolders, run: run(async () => { for (const r of items) await this.openTab(tab.folderView ? tab.view : this.defaultView(), r.path); }) },
        "separator",
        // 切り取り・コピー・貼り付けはメニューに出さない（知っていて当然の操作なので、キーだけにする。ADR 0015 判断1）
        { label: "名前の変更", shortcut: "F2", disabled: !single || !raws[0], run: () => raws[0] && tab.host.requestRename(raws[0]) },
        { label: "パスのコピー", run: copyPaths(items.map((r) => r.path)) },
        {
          label: pinned ? "クイックアクセスから外す" : "クイックアクセスにピン留め",
          disabled: !single || !allFolders,
          run: () => single && (pinned ? quickAccess.unpin([single]) : quickAccess.pin([single])),
        },
        "separator",
        ...(archive ? [{ label: "ここに展開", run: run(() => this.extract(single!)) }] : []),
        ...(sevenZip.available
          ? [
              { label: "zip に圧縮", run: run(() => this.compress(items, "zip")) },
              { label: "7z に圧縮", run: run(() => this.compress(items, "7z")) },
            ]
          : []),
        "separator",
        ...(onedrive
          ? [od("OneDrive で共有…", "share"), od("OneDrive のリンクをコピー", "copyLink"), od("OneDrive のアクセス許可の管理…", "manageAccess"), od("オンラインで表示", "viewOnline"), "separator" as const]
          : []),
        { label: "タグ…", run: run(() => tagPicker(items)) },
        { label: "時間割のコマに結びつける…", disabled: !single || !allFolders, run: run(() => slotPicker(items[0], (m) => this.toast(m))) },
        "separator",
        { label: "ごみ箱へ送る", shortcut: "Delete", run: run(() => this.trash(tab, items)) },
      );
    } else if (tab.folderView && extra.length === 0) {
      // 項目を選ばずに右クリックしたとき。ビューが自分の項目（extra）だけを出したいときは、標準の項目を足さない
      lines.push(
        { label: "新しいフォルダー", shortcut: "Ctrl+Shift+N", disabled: !tab.folder, run: run(() => this.createFolder(tab)) },
        { label: "最新の情報に更新", shortcut: "F5", run: () => this.refresh() },
        { label: "パスのコピー", disabled: !tab.folder, run: copyPaths(tab.folder ? [tab.folder.path] : []) },
      );
    }
    if (extra.length > 0) {
      lines.push("separator", ...extra.map((m) => ({ label: m.label, run: () => (chosen = m.id) })));
    }
    if (lines.length === 0) return null;
    await showMenu(x, y, lines);
    return chosen;
  }

  /** 本体のショートカット。扱ったら true */
  handleKey(k: KeyMessage): boolean {
    const t = this.active;
    const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
    if (key === "F5") {
      this.refresh();
      return true;
    }
    if (k.ctrl && k.shift && !k.alt && key === "n") {
      if (t?.folderView) void this.createFolder(t).catch((e) => this.toast(`フォルダーを作れませんでした：${errorText(e)}`));
      return true;
    }
    if (k.ctrl && !k.alt) {
      if (key === "t") {
        void this.openHome();
        return true;
      }
      if (key === "w") {
        if (t) this.closeTab(t);
        return true;
      }
      if (key === "l") {
        this.editAddress();
        return true;
      }
      if (key === "Tab" && t && this.tabs.length > 1) {
        const i = this.tabs.indexOf(t);
        this.activate(this.tabs[(i + (k.shift ? -1 : 1) + this.tabs.length) % this.tabs.length]);
        return true;
      }
    }
    if (k.alt && !k.ctrl) {
      if (key === "ArrowLeft") return void this.goBack(), true;
      if (key === "ArrowRight") return void this.goForward(), true;
      if (key === "ArrowUp") return t ? (void t.navigateUp(), true) : false;
    }
    return false;
  }

  private toast(message: string) {
    const t = el("div", "toast", message);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
}
