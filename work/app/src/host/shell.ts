// 本体の画面：タブ、アドレスバー、ビューの切り替え、よく使う場所、状態の表示。
// ファイルの中身の見せ方はビュー（MOD）に任せ、ここは「どのフォルダを、どのビューで」を管理する。
import type { EntryRef, KeyMessage, Rect } from "../api/types";
import { backend, BackendError, type Place, type RawFolder } from "./backend";
import { confirmDialog, playOpen, playTrash } from "./effects";
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
    this.button.append(this.label, close);
    this.button.onclick = () => app.activate(this);
    this.button.onauxclick = (e) => e.button === 1 && app.closeTab(this);
    this.host = new ViewHost(this.pane, view, this);
  }

  setView(view: LoadedView) {
    this.host.destroy();
    this.view = view;
    this.host = new ViewHost(this.pane, view, this);
    if (this.folder) this.host.setFolder(this.folder);
  }

  setFolder(folder: RawFolder) {
    this.folder = folder;
    this.label.textContent = folder.name;
    this.button.title = folder.path;
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
  open = (ref: EntryRef, from?: Rect) => this.app.open(this, ref, from);
  trash = (refs: EntryRef[], from?: Rect) => this.app.trash(this, refs, from);
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
    this.viewSelect.onchange = () => {
      const v = this.views.find((x) => x.manifest.id === this.viewSelect.value);
      if (v && this.active) this.active.setView(v);
    };
    const navRow = el("div", "nav-row");
    navRow.append(this.backBtn, this.forwardBtn, this.upBtn, this.refreshBtn, this.address, this.viewSelect);

    this.renderSidebar();
    const body = el("div", "body");
    body.append(this.sidebar, this.content);
    root.append(tabsRow, navRow, body, this.status);

    document.addEventListener("keydown", (e) => {
      if (e.key === "F5") {
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

  async open(tab: Tab, ref: EntryRef, from?: Rect) {
    let isDir = tab.folder?.entries.find((e) => e.path === ref.path)?.isDir;
    if (isDir === undefined) {
      // 今のフォルダに無いもの（リンクで指しているものなど）は、ID から探す
      const [found] = await backend.resolve([ref]);
      if (!found) throw new BackendError({ code: "not-found", message: ref.path });
      isDir = found.isDir;
    }
    if (isDir) {
      await this.navigate(tab, ref.path);
      return;
    }
    playOpen(from);
    await backend.openEntry(ref);
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

  /** 本体のショートカット。扱ったら true */
  handleKey(k: KeyMessage): boolean {
    const t = this.active;
    const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
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
