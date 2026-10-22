// 右クリックのメニューから、MOD を見えない所で動かす（manifest の menu の run が "background"。ADR 0036）。
// 画面の無いタブのようなもの：ファイルの操作は右クリックしたタブに頼み、タブに関わる操作（移動・メニュー・ドラッグ）は断る。
// MOD が menu.done を呼ぶか、しばらく何もしなくなったら止める。
import type { EntryRef, KeyMessage, Rect } from "../api/types";
import { BackendError, type RawFolder } from "./backend";
import { ViewHost, type LoadedView, type TabActions } from "./view-host";

/** API を呼ばず、返事待ちのものも無いまま、これだけたったら止める */
const IDLE_MS = 30_000;
/** 始めてから、これだけたったら止める */
const MAX_MS = 10 * 60_000;
const CHECK_MS = 5_000;

let runCounter = 0;

const denied = (what: string): never => {
  throw new BackendError({ code: "denied", message: `${what} is not available in the background` });
};

export class MenuRun implements TabActions {
  readonly tabId = `menu-run-${++runCounter}`;
  readonly background = true;
  readonly host: ViewHost;
  private readonly started = Date.now();
  private readonly timer: ReturnType<typeof setInterval>;
  private ended = false;

  constructor(
    container: HTMLElement,
    readonly view: LoadedView,
    /** 右クリックしたタブ */
    private readonly origin: TabActions,
    folder: RawFolder | null,
    private readonly onEnd: (run: MenuRun) => void,
  ) {
    this.host = new ViewHost(container, view, this);
    if (folder) this.host.setFolder(folder);
    this.timer = setInterval(() => {
      if (this.host.idleFor() > IDLE_MS || Date.now() - this.started > MAX_MS) this.end();
    }, CHECK_MS);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    this.host.destroy();
    this.onEnd(this);
  }

  // ---- TabActions ----
  menuDone = () => this.end();
  theme = () => this.origin.theme();
  // 選ばれた直後なので、表示中のタブでなくても、お知らせ・確かめの画面を出せる
  isActive = () => true;
  toast = (text: string) => this.origin.toast(text);
  // 状態の欄・タブの名前は、見せる場所が無いので何もしない
  setStatus = () => {};
  setTabLabel = () => {};
  shortcut = (_key: KeyMessage) => {};
  get mods() {
    return this.origin.mods;
  }
  listViews = () => this.origin.listViews();
  // フォルダは、右クリックしたタブを動かさずに新しいタブで開く
  open = (ref: EntryRef, from?: Rect) => this.origin.open(ref, from, true);
  openTab = (viewId: string, path?: string) => this.origin.openTab(viewId, path, false);
  trash = (refs: EntryRef[], from?: Rect) => this.origin.trash(refs, from);
  rename = (ref: EntryRef, newName: string) => this.origin.rename(ref, newName);
  // 名前を付けないと、作った後にビューで名前の変更を始めることになるので、断る
  createFolder = (name?: string) => (name === undefined ? denied("createFolder without a name") : this.origin.createFolder(name));
  clipboardSet = (items: EntryRef[], cut: boolean) => this.origin.clipboardSet(items, cut);
  clipboardPaste = () => denied("clipboard.paste");
  navigate = () => denied("navigate");
  navigateUp = () => denied("navigateUp");
  showMenu = () => denied("showMenu");
  dragStart = () => denied("drag.start");
  dragTargets = () => denied("drag.targets");
  dragMove = () => denied("drag.move");
  dragEnd = () => denied("drag.end");
}
