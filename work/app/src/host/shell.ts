// 本体の画面：タブ、アドレスバー、ビューの切り替え、よく使う場所、状態の表示。
// ファイルの中身の見せ方はビュー（MOD）に任せ、ここは「どのフォルダを、どのビューで」を管理する。
import type { EntryRef, KeyMessage, MenuItem, Rect } from "../api/types";
import { uniqueName } from "../core/names";
import { backend, BackendError, type Place, type RawEntry, type RawFolder } from "./backend";
import { confirmDialog, playOpen, playTrash } from "./effects";
import { showMenu, type MenuLine } from "./menu";
import { slotPicker, tagPicker } from "./pickers";
import { timetableService } from "./timetable-service";
import type { ModProblem } from "./mods";
import { ViewHost, type LoadedView, type TabActions } from "./view-host";

const DEFAULT_VIEW_ID = "builtin.win11";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function currentTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
  host: ViewHost;

  constructor(
    private readonly app: App,
    public view: LoadedView,
  ) {
    const close = el("button", "tab-close", "×");
    close.title = "タブを閉じる (Ctrl+W)";
    close.onclick = (e) => {
      e.stopPropagation();
      app.closeTab(this);
    };
    // 標準以外のビューのタブには、ビューの名前を小さく出す（同じフォルダを別のビューで並べたとき見分けるため）
    this.badge.textContent = view.manifest.id === DEFAULT_VIEW_ID ? "" : view.manifest.name;
    this.button.append(this.label, this.badge, close);
    this.button.onclick = () => app.activate(this);
    this.button.onauxclick = (e) => e.button === 1 && app.closeTab(this);
    this.host = new ViewHost(this.pane, view, this);
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
  createFolder = () => this.app.createFolder(this);
  showMenu = (x: number, y: number, items: EntryRef[], extra: MenuItem[]) => this.app.showMenu(this, x, y, items, extra);
  shortcut = (key: KeyMessage) => this.app.handleKey(key);
}

export class App {
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private readonly tabStrip = el("div", "tab-strip");
  private readonly address = el("input", "address");
  private readonly viewSelect = el("select", "view-select");
  private readonly sidebar = el("nav", "sidebar");
  private readonly content = el("main", "content");
  private readonly status = el("footer", "status");
  private readonly backBtn = el("button", "nav-btn", "←");
  private readonly forwardBtn = el("button", "nav-btn", "→");
  private readonly upBtn = el("button", "nav-btn", "↑");
  private readonly refreshBtn = el("button", "nav-btn", "⟳");

  constructor(
    private readonly views: LoadedView[],
    private readonly problems: ModProblem[],
    private readonly places: Place[],
    /** 最初に開くフォルダ（開発中に、試験用のフォルダで起動するため。ふだんは null） */
    private readonly startDir: string | null = null,
  ) {}

  mount(root: HTMLElement) {
    document.documentElement.dataset.theme = currentTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      document.documentElement.dataset.theme = currentTheme();
      for (const t of this.tabs) t.host.setTheme(currentTheme());
    });

    const newTab = el("button", "tab-new", "+");
    newTab.title = "新しいタブ (Ctrl+T)";
    newTab.onclick = () => void this.openTab(this.active?.folder?.path ?? this.homePath());
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
    this.address.spellcheck = false;
    this.address.title = "場所 (Ctrl+L)";
    this.address.onkeydown = (e) => {
      if (e.key === "Enter" && this.active) void this.navigate(this.active, this.address.value.trim());
      if (e.key === "Escape") {
        this.address.value = this.active?.folder?.path ?? "";
        this.active?.host.focus();
      }
    };
    for (const v of this.views) {
      const o = el("option", undefined, v.manifest.name);
      o.value = v.manifest.id;
      this.viewSelect.appendChild(o);
    }
    this.viewSelect.title = "ビュー";
    // ビューを選ぶと、今のタブは残し、同じフォルダをそのビューで新しいタブに開く（ADR 0009 判断3）
    this.viewSelect.onchange = () => {
      const v = this.views.find((x) => x.manifest.id === this.viewSelect.value);
      const t = this.active;
      if (!v || !t) return;
      this.viewSelect.value = t.view.manifest.id;
      void this.openTab(t.folder?.path ?? this.homePath(), v);
    };
    const navRow = el("div", "nav-row");
    navRow.append(this.backBtn, this.forwardBtn, this.upBtn, this.refreshBtn, this.address, this.nowBtn, this.viewSelect);
    this.startNowWatch();

    this.renderSidebar();
    const body = el("div", "body");
    body.append(this.sidebar, this.content);
    root.append(tabsRow, navRow, body, this.status);

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
    void this.openTab(this.homePath());
  }

  private homePath(): string {
    return (
      this.startDir ??
      this.places.find((p) => p.kind === "documents")?.path ??
      this.places.find((p) => p.kind === "home")?.path ??
      "C:\\"
    );
  }

  private renderSidebar() {
    const labels: Record<string, string> = {
      home: "ホーム",
      desktop: "デスクトップ",
      documents: "ドキュメント",
      downloads: "ダウンロード",
      pictures: "ピクチャ",
      music: "ミュージック",
      videos: "ビデオ",
    };
    for (const p of this.places) {
      const b = el("button", `place place-${p.kind}`, p.kind === "drive" ? `ドライブ ${p.name}` : (labels[p.kind] ?? p.name));
      b.title = p.path;
      b.onclick = () => this.active && void this.navigate(this.active, p.path);
      this.sidebar.appendChild(b);
    }
  }

  private defaultView(): LoadedView {
    return this.views.find((v) => v.manifest.id === DEFAULT_VIEW_ID) ?? this.views[0];
  }

  async openTab(path: string, view = this.active?.view ?? this.defaultView()) {
    const tab = new Tab(this, view);
    this.tabs.push(tab);
    this.tabStrip.appendChild(tab.button);
    this.content.appendChild(tab.pane);
    this.activate(tab);
    await this.navigate(tab, path, false);
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
    if (this.active === tab) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]);
  }

  activate(tab: Tab) {
    this.active = tab;
    for (const t of this.tabs) {
      const on = t === tab;
      t.button.classList.toggle("active", on);
      t.pane.classList.toggle("active", on);
    }
    this.viewSelect.value = tab.view.manifest.id;
    this.updateChrome();
    tab.host.focus();
  }

  private updateChrome() {
    const t = this.active;
    this.address.value = t?.folder?.path ?? "";
    this.backBtn.disabled = !t || t.back.length === 0;
    this.forwardBtn.disabled = !t || t.forward.length === 0;
    this.upBtn.disabled = !t?.folder?.parentPath;
    this.status.textContent = t?.folder ? `${t.folder.entries.length} 個の項目` : "";
    document.title = t?.folder ? `${t.folder.name} - explorer_plus` : "explorer_plus";
  }

  async navigate(tab: Tab, path: string, record = true) {
    let folder: RawFolder;
    try {
      folder = await backend.listDir(path);
    } catch (e) {
      const msg = e instanceof BackendError && e.apiError.code === "not-found" ? `フォルダが見つかりません：${path}` : `開けませんでした：${path}`;
      this.toast(msg);
      if (tab === this.active) this.address.value = tab.folder?.path ?? "";
      throw e;
    }
    if (record && tab.folder && tab.folder.path !== folder.path) {
      tab.back.push(tab.folder.path);
      tab.forward = [];
    }
    tab.setFolder(folder);
    if (tab === this.active) this.updateChrome();
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
    if (t?.folder) void this.navigate(t, t.folder.path, false);
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
      if (newTab) await this.openTab(target.path, this.defaultView());
      else await this.navigate(tab, target.path);
      return;
    }
    playOpen(from);
    await backend.openEntry(target);
  }

  // ---- 今の授業（ADR 0010。どのビューを開いていても、アドレスバーの横に出す） ----

  private readonly nowBtn = el("button", "now-class");
  private nowFolder: EntryRef | null = null;

  private async updateNow() {
    let label = "";
    this.nowFolder = null;
    try {
      const now = await timetableService.current();
      if (now) {
        label = `今：${now.slot.title || now.period.label}`;
        this.nowFolder = now.slot.folders[0] ?? null;
      }
    } catch (e) {
      console.warn("current class failed", e);
    }
    this.nowBtn.textContent = label;
    this.nowBtn.hidden = !label;
    this.nowBtn.title = this.nowFolder ? `${this.nowFolder.path} を新しいタブで開く` : "このコマにはフォルダが結びついていません（右クリックのメニューで結びつけられます）";
    this.nowBtn.classList.toggle("no-folder", !this.nowFolder);
  }

  private startNowWatch() {
    this.nowBtn.hidden = true;
    this.nowBtn.onclick = () => {
      if (!this.nowFolder) {
        this.toast("このコマにはフォルダが結びついていません。フォルダを右クリックして「時間割のコマに結びつける…」を選んでください");
        return;
      }
      // 今のタブは壊さず、新しいタブで開く（ADR 0009 判断3）
      const t = this.active;
      if (t) void this.open(t, this.nowFolder, undefined, true).catch(() => this.toast(`フォルダが見つかりません：${this.nowFolder?.path}`));
    };
    void this.updateNow();
    timetableService.onChange(() => void this.updateNow());
    setInterval(() => void this.updateNow(), 30_000);
  }

  async trash(tab: Tab, refs: EntryRef[], from?: Rect): Promise<number> {
    const names = refs.map((r) => r.path.split("\\").pop() ?? r.path);
    const message = refs.length === 1 ? `「${names[0]}」をごみ箱へ送りますか？` : `${refs.length} 個の項目をごみ箱へ送りますか？`;
    if (!(await confirmDialog(message, "ごみ箱へ送る"))) {
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

  /** 今のフォルダに、重ならない名前で「新しいフォルダー」を作り、ビューに名前の変更を始めてもらう */
  async createFolder(tab: Tab): Promise<RawEntry> {
    if (!tab.folder) throw new BackendError({ code: "not-found", message: "no folder is open" });
    const name = uniqueName("新しいフォルダー", tab.folder.entries.map((e) => e.name));
    const raw = await backend.createFolder(tab.folder.path, name);
    await this.navigate(tab, tab.folder.path, false);
    tab.host.requestRename(raw);
    return raw;
  }

  /** 右クリックのメニュー（ADR 0009 判断2）。MOD が足した項目が選ばれたら、その id を返す */
  async showMenu(tab: Tab, x: number, y: number, items: EntryRef[], extra: MenuItem[]): Promise<string | null> {
    let chosen: string | null = null;
    const raws = items.map((r) => tab.folder?.entries.find((e) => e.path === r.path));
    const run = (work: () => Promise<unknown>) => () =>
      void work().catch((e) => {
        if (!(e instanceof BackendError && e.apiError.code === "denied")) this.toast(`できませんでした：${e instanceof Error ? e.message : String(e)}`);
      });
    const copyPaths = (paths: string[]) => run(() => navigator.clipboard.writeText(paths.map((p) => `"${p}"`).join("\r\n")));
    const lines: MenuLine[] = [];
    if (items.length > 0) {
      const allFolders = raws.every((r) => r?.isDir);
      lines.push(
        { label: "開く", shortcut: "Enter", run: run(() => (items.length === 1 ? this.open(tab, items[0]) : Promise.all(items.filter((_, i) => !raws[i]?.isDir).map((r) => backend.openEntry(r))))) },
        { label: "新しいタブで開く", disabled: !allFolders, run: run(async () => { for (const r of items) await this.openTab(r.path, tab.view); }) },
        "separator",
        { label: "名前の変更", shortcut: "F2", disabled: items.length !== 1 || !raws[0], run: () => raws[0] && tab.host.requestRename(raws[0]) },
        { label: "パスのコピー", run: copyPaths(items.map((r) => r.path)) },
        "separator",
        { label: "タグ…", run: run(() => tagPicker(items)) },
        { label: "時間割のコマに結びつける…", disabled: items.length !== 1 || !raws[0]?.isDir, run: run(() => slotPicker(items[0], (m) => this.toast(m))) },
        "separator",
        { label: "ごみ箱へ送る", shortcut: "Delete", run: run(() => this.trash(tab, items)) },
      );
    } else {
      lines.push(
        { label: "新しいフォルダー", shortcut: "Ctrl+Shift+N", disabled: !tab.folder, run: run(() => this.createFolder(tab)) },
        { label: "最新の情報に更新", shortcut: "F5", run: () => this.refresh() },
        { label: "パスのコピー", disabled: !tab.folder, run: copyPaths(tab.folder ? [tab.folder.path] : []) },
      );
    }
    if (extra.length > 0) {
      lines.push("separator", ...extra.map((m) => ({ label: m.label, run: () => (chosen = m.id) })));
    }
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
      if (t) void this.createFolder(t).catch((e) => this.toast(`フォルダーを作れませんでした：${e instanceof Error ? e.message : String(e)}`));
      return true;
    }
    if (k.ctrl && !k.alt) {
      if (key === "t") {
        void this.openTab(t?.folder?.path ?? this.homePath());
        return true;
      }
      if (key === "w") {
        if (t) this.closeTab(t);
        return true;
      }
      if (key === "l") {
        this.address.focus();
        this.address.select();
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
