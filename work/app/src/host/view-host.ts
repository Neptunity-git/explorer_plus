// 1つのタブの中で、1つのビュー MOD を iframe に読み込み、MOD からのメッセージに答える（docs/design/mod-api-v1.md）。
// MOD は他人が書いたプログラムなので、届いたメッセージは必ず parseModMessage と checkPermission を通してから扱う。
import {
  PROTOCOL_VERSION,
  type ApiError,
  type CallMessage,
  type EntryRef,
  type HostToModMessage,
  type KeyMessage,
  type Manifest,
  type MenuItem,
  type Rect,
  type TreeNode,
  type Use,
  type ViewInfo,
} from "../api/types";
import { sortEntries } from "../core/entries";
import { parseModMessage } from "../core/protocol";
import { validateFileName } from "../core/names";
import { checkPermission, checkStorageValue } from "../core/permission";
import { onModsChange, type ModManager } from "./mod-manager";
import { INFO_PROPERTY_NAMES, toFileInfo } from "../core/fileinfo";
import { parseNetFrame } from "../core/network";
import { describeModCall } from "../core/logs";
import { logService } from "./log-service";
import { broadcast, onSync } from "./sync";
import type { ChoiceItem, FileChange } from "../api/types";
import { askDialog, chooseDialog, settingsService } from "./mod-ui";
import { collectionService, grantService } from "./collection-service";

/** バイト列を base64 に（Rust へ渡すため） */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
import { confirmDialog } from "./effects";
import { backend, BackendError, MOD_ORIGIN, toApiError, type RawEntry, type RawFolder } from "./backend";
import { toEntry, toSnapshot } from "./snapshot";
import { storageFor } from "./view-storage";
import { tagService } from "./tag-service";
import { timetableService } from "./timetable-service";
import { quickAccess, recentItems } from "./ref-list-service";
import type { WindowTarget } from "./drag";

/** source：標準のビュー・入れた MOD・開発中の MOD（ADR 0020）。dir は MOD のフォルダ */
export type LoadedView = { manifest: Manifest; source: "builtin" | "user" | "dev"; dir: string };

/** ビューが本体（タブ）に頼めること。画面上の位置は、本体の画面の座標に直してから渡す */
export interface TabActions {
  readonly tabId: string;
  theme(): "light" | "dark";
  navigate(path: string): Promise<void>;
  navigateUp(): Promise<void>;
  /** newTab：フォルダを新しいタブ（標準のビュー）で開く */
  open(ref: EntryRef, from?: Rect, newTab?: boolean): Promise<void>;
  trash(refs: EntryRef[], from?: Rect): Promise<number>;
  rename(ref: EntryRef, newName: string): Promise<RawEntry>;
  /** 今のフォルダに新しいフォルダを作る（name を省略すると「新しいフォルダー」）。作った後、本体がビューに action（rename）を送る */
  createFolder(name?: string): Promise<RawEntry>;
  /** 右クリックのメニュー。MOD が足した項目が選ばれたらその id、それ以外は null */
  showMenu(x: number, y: number, items: EntryRef[], extra: MenuItem[]): Promise<string | null>;
  shortcut(key: KeyMessage): void;
  /** 使えるビューの一覧（ホームで使う） */
  listViews(): ViewInfo[];
  /** 新しいタブを開く。replace なら、このタブを置き換える */
  openTab(viewId: string, path?: string, replace?: boolean): Promise<void>;
  // ↓ 切り取り・コピー・貼り付けと、ドラッグ＆ドロップ（ADR 0015）。座標は本体の画面の座標
  clipboardSet(items: EntryRef[], cut: boolean): Promise<void>;
  /** 今のフォルダへ貼り付け、貼り付けた数を返す */
  clipboardPaste(): Promise<number>;
  dragStart(items: EntryRef[], x: number, y: number, targets: WindowTarget[]): void;
  dragTargets(targets: WindowTarget[]): void;
  dragMove(x: number, y: number, ctrl: boolean, shift: boolean): void;
  dragEnd(x: number, y: number, ctrl: boolean, shift: boolean, cancel: boolean): Promise<void>;
  /** MOD の管理（ADR 0020）。標準のビューだけが使える */
  readonly mods: ModManager;
  // ↓ 本体の画面を使う（ADR 0024）
  /** このタブが表示中か（確かめの画面・お知らせは、表示中のタブのビューだけが出せる） */
  isActive(): boolean;
  toast(text: string): void;
  setStatus(text: string | null): void;
  setTabLabel(p: { title?: string | null; badge?: string | null }): void;
}

/** 並べ替えのためだけに Entry を作るときの uses（余計な情報を付けない） */
const NO_EXTRAS: ReadonlySet<Use> = new Set();

/** 木を作るときに読むフォルダの数の上限（大きなフォルダで止まらないように） */
const TREE_MAX_FOLDERS = 500;
/** フォルダの合計の大きさを、この間隔でまとめてビューに知らせる */
const FOLDER_SIZE_FLUSH_MS = 250;

class HostError extends Error {
  constructor(readonly apiError: ApiError) {
    super(apiError.message);
  }
}

export class ViewHost {
  readonly iframe: HTMLIFrameElement;
  private readonly uses: ReadonlySet<Use>;
  private isReady = false;
  private folder: RawFolder | null = null;
  /** フォルダが変わるたびに増やす。古いフォルダの大きさの計算結果を捨てるため */
  private generation = 0;
  private readonly onMessage = (ev: MessageEvent) => this.handleMessage(ev);

  constructor(
    container: HTMLElement,
    readonly view: LoadedView,
    private readonly tab: TabActions,
  ) {
    this.uses = new Set(view.manifest.uses);
    this.iframe = document.createElement("iframe");
    // allow-same-origin を付けない：MOD は出どころ null になり、本体や Tauri の機能に触れられない（ADR 0007 判断6）
    this.iframe.setAttribute("sandbox", "allow-scripts");
    this.iframe.className = "view-frame";
    // title にすると WebView2 ではビューの上のどこでもツールチップが出てしまうので、読み上げ用の名前だけ付ける
    this.iframe.setAttribute("aria-label", view.manifest.name);
    this.iframe.src = `${MOD_ORIGIN}/${view.manifest.id}/__frame.html`;
    window.addEventListener("message", this.onMessage);
    container.appendChild(this.iframe);
    // タグ・時間割が変わったら、宣言しているビューにだけ知らせる（ADR 0010）
    if (this.uses.has("tags")) {
      this.unsubscribe.push(
        tagService.onChange(() => {
          if (!this.isReady) return;
          this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "tags", data: tagService.list() });
          // Entry の tags も変わるので、今のフォルダを送り直す
          this.pushFolder();
        }),
      );
    }
    if (this.uses.has("timetable")) this.unsubscribe.push(timetableService.onChange(() => this.pushTimetable()));
    if (this.uses.has("quickAccess")) {
      this.unsubscribe.push(quickAccess.onChange(() => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "quickAccess", data: null })));
    }
    // コレクションが変わったら知らせる（ADR 0025）
    if (this.uses.has("collections")) {
      this.unsubscribe.push(collectionService.onChange(() => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "collections", data: collectionService.list() })));
    }
    // 設定の値が変わったら知らせる（ADR 0024）
    if (view.manifest.settings) {
      this.unsubscribe.push(settingsService.onChange(view.manifest.id, (v) => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "settings", data: v })));
    }
    // ほかのウィンドウが、開いているフォルダのこのビューのデータを書き換えた（ADR 0030）
    if (this.uses.has("folderData")) {
      this.unsubscribe.push(
        onSync((m) => {
          if (m.kind !== "folderData" || m.name !== this.folderDataName() || !this.isReady) return;
          if (this.folder && this.folder.path.toLowerCase() === m.path.toLowerCase()) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "folderData", data: { path: this.folder.path } });
        }),
      );
    }
    if (view.source === "builtin") {
      this.unsubscribe.push(onModsChange(() => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "mods", data: null })));
      // ログが増えたら知らせる（ホームのログの欄。フォルダと関係ない標準のビューだけ。ADR 0029）
      if (view.manifest.location === "none") this.unsubscribe.push(logService.onEntry((e) => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "logs", data: e })));
    }
    if (this.uses.has("recent")) {
      this.unsubscribe.push(recentItems.onChange(() => this.isReady && this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "recent", data: null })));
    }
  }

  /** 今のフォルダ（時間割はフォルダごと。ADR 0012） */
  private folderRef(): EntryRef {
    if (!this.folder) throw new HostError({ code: "not-found", message: "no folder is open" });
    return { id: this.folder.id, path: this.folder.path };
  }

  /** このビューのコマンド（コマンドの一覧に出す。ADR 0024） */
  commands: ChoiceItem[] = [];
  private lastToast = 0;
  private modalOpen = false;

  /** 確かめ・入力・選択の画面。表示中のタブのビューだけ、同時に1つまで */
  private async modal<T>(open: () => Promise<T>): Promise<T> {
    if (!this.tab.isActive() || this.modalOpen) throw new HostError({ code: "denied", message: "only the visible view can open one dialog at a time" });
    this.modalOpen = true;
    try {
      return await open();
    } finally {
      this.modalOpen = false;
    }
  }

  /**
   * MOD ごとの許可（ADR 0025）。最初に使うときだけ本体が聞き、覚えておく。標準のビューは聞かない。
   * 聞く画面は、表示中のタブのビューからだけ出せる
   */
  private async ensureGrant(what: string, doing: string) {
    if (this.view.source === "builtin" || (await grantService.has(this.view.manifest.id, what))) return;
    const ok = await this.modal(() =>
      confirmDialog(
        `「${this.view.manifest.name}」が、${doing}。\n許可しますか？\n\n許可すると、このビューは新しいファイル・フォルダ・ショートカットを作れるようになります（今あるものを書き換えたり消したりはできません）。MOD を外すと許可も消えます。`,
        "許可する",
      ),
    );
    if (!ok) throw new HostError({ code: "denied", message: "the user did not allow creating files" });
    await grantService.grant(this.view.manifest.id, what);
  }

  /** コマンドの一覧で、このビューのコマンドが選ばれた */
  runCommand(id: string) {
    if (this.isReady) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "command", data: { id } });
  }

  /** フォルダの直下で起きた変化を知らせる（ADR 0023）。フォルダの中身を見るビュー（uses に entries）だけ */
  pushChanges(changes: FileChange[]) {
    if (this.isReady && changes.length > 0 && this.uses.has("entries")) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "changes", data: changes });
  }

  /** フォルダの中のデータの名前（.explorer_plus/view.<ビューの id>.json） */
  private folderDataName(): string {
    return `view.${this.view.manifest.id}`;
  }

  /** フォルダに書けないときの、このビューの保存場所のキー */
  private folderDataKey(f: EntryRef): string {
    return `folderData:${f.id || f.path.toLowerCase()}`;
  }

  private pushTimetable() {
    if (this.isReady && this.folder) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "timetable", data: timetableService.get(this.folderRef()) });
  }

  private readonly unsubscribe: (() => void)[] = [];

  destroy() {
    this.generation++;
    window.removeEventListener("message", this.onMessage);
    for (const off of this.unsubscribe) off();
    this.iframe.remove();
  }

  focus() {
    this.iframe.focus();
  }

  /** タブのフォルダが変わった（または読み直した）ときに呼ぶ */
  setFolder(folder: RawFolder) {
    const moved = this.folder?.path !== folder.path;
    this.folder = folder;
    this.generation++;
    if (this.isReady) this.pushFolder();
    if (moved && this.uses.has("timetable")) this.pushTimetable();
  }

  setTheme(theme: "light" | "dark") {
    if (this.isReady) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "theme", data: theme });
  }

  /** ドラッグ中にこのビューのタブへ切り替わった。落とせる場所を知らせ直してもらう（ADR 0015 判断2） */
  requestDragTargets() {
    if (this.isReady) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "dragTargets", data: null });
  }

  /** ビューの中の落とせる場所（iframe の中の座標）を、本体の画面の座標に直す */
  private toWindowTargets(targets: { id: string; path: string; x: number; y: number; width: number; height: number }[]): WindowTarget[] {
    const box = this.iframe.getBoundingClientRect();
    return targets.map((t) => ({ ref: { id: t.id, path: t.path }, rect: { x: box.x + t.x, y: box.y + t.y, width: t.width, height: t.height } }));
  }

  /** ビューに「この項目の名前の変更を始めて」と頼む（対応していないビューは無視する） */
  requestRename(raw: RawEntry) {
    if (this.isReady) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "action", data: { action: "rename", entry: toEntry(raw, this.uses) } });
  }

  private post(msg: HostToModMessage) {
    // MOD の iframe は出どころ null なので、宛先の origin は "*" しか指定できない（送り先の window そのものに送っている）
    this.iframe.contentWindow?.postMessage(msg, "*");
  }

  private pushFolder() {
    if (!this.folder) return;
    const folder = this.folder;
    const gen = this.generation;
    this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "folder", data: toSnapshot(folder, this.uses) });
    if (this.uses.has("folderSize")) void this.pushFolderSizes(folder, gen);
  }

  /** フォルダの合計の大きさを1つずつ計算し、少しずつビューに知らせる */
  private async pushFolderSizes(folder: RawFolder, gen: number) {
    const sizes = new Map<string, number>();
    let lastFlush = performance.now();
    for (const e of folder.entries) {
      if (!e.isDir) continue;
      if (gen !== this.generation) return;
      try {
        const [size] = await backend.folderSizes([e.path]);
        sizes.set(e.path, size);
      } catch {
        continue;
      }
      if (performance.now() - lastFlush > FOLDER_SIZE_FLUSH_MS && gen === this.generation) {
        this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "folder", data: toSnapshot(folder, this.uses, sizes) });
        lastFlush = performance.now();
      }
    }
    if (gen === this.generation && sizes.size > 0) {
      this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "folder", data: toSnapshot(folder, this.uses, sizes) });
    }
  }

  private handleMessage(ev: MessageEvent) {
    // 送り主が、このビューの iframe かどうかを確かめる（出どころが null なので origin では確かめられない）
    if (ev.source !== this.iframe.contentWindow) return;
    const parsed = parseModMessage(ev.data);
    if (!parsed.ok) {
      if (parsed.id !== null) this.reply(parsed.id, Promise.reject(new HostError(parsed.error)));
      return;
    }
    const msg = parsed.message;
    if (msg.kind === "key") {
      this.tab.shortcut(msg);
      return;
    }
    // MOD の console.log・エラー（ADR 0029）
    if (msg.kind === "log") {
      logService.mod(this.view.manifest.id, msg.level, msg.text);
      return;
    }
    // MOD の管理・ログは、標準のビュー（ホーム）だけ。ほかの MOD が勝手に MOD を入れ替えたり、ほかの MOD のログを読んだりしないように（ADR 0020・0029）
    if ((msg.method.startsWith("mods.") || msg.method.startsWith("logs.")) && this.view.source !== "builtin") {
      this.reply(msg.id, this.track(msg, Promise.reject(new HostError({ code: "denied", message: `${msg.method} is only for built-in views` }))));
      return;
    }
    const denied = checkPermission(this.view.manifest.uses, msg.method);
    if (denied) {
      this.reply(msg.id, this.track(msg, Promise.reject(new HostError(denied))));
      return;
    }
    this.reply(msg.id, this.track(msg, this.dispatch(msg)));
  }

  /** MOD が本体に頼んだことを、その MOD のログに残す（ファイルを変える・通信する・断られた。ADR 0029） */
  private track(msg: CallMessage, work: Promise<unknown>): Promise<unknown> {
    // 標準のビューは、本体のログに残るので、ここでは残さない
    if (this.view.source === "builtin") return work;
    const id = this.view.manifest.id;
    return work.then(
      (value) => {
        const text = describeModCall(msg.method, msg.params as Record<string, unknown>, value);
        if (text) logService.mod(id, "info", text);
        return value;
      },
      (e) => {
        const err = e instanceof HostError || e instanceof BackendError ? e.apiError : toApiError(e);
        logService.mod(id, "warn", `${msg.method} — ${err.code}: ${err.message}`);
        throw e;
      },
    );
  }

  private reply(id: number, work: Promise<unknown>) {
    work.then(
      (value) => this.post({ ep: PROTOCOL_VERSION, kind: "result", id, ok: true, value }),
      (e) => {
        const error = e instanceof HostError || e instanceof BackendError ? e.apiError : toApiError(e);
        this.post({ ep: PROTOCOL_VERSION, kind: "result", id, ok: false, error });
      },
    );
  }

  /** iframe の中の座標を、本体の画面の座標に直す */
  private toWindowRect(r: Rect | undefined): Rect | undefined {
    if (!r) return undefined;
    const box = this.iframe.getBoundingClientRect();
    return { x: box.x + r.x, y: box.y + r.y, width: r.width, height: r.height };
  }

  // parseModMessage が method ごとの params の形を確かめ済みなので、ここでは型を当てはめるだけ
  private async dispatch(msg: CallMessage): Promise<unknown> {
    const p = msg.params as Record<string, any>;
    const store = storageFor(this.view.manifest.id);
    switch (msg.method) {
      case "ready":
        if (!this.isReady) {
          this.isReady = true;
          // 表示中のタブなら、キーボードの操作がすぐビューに届くようにする
          if (this.iframe.closest(".view-pane.active") && !document.querySelector(".dialog-backdrop, .menu-backdrop")) this.iframe.focus();
          // 返事が届いた後にフォルダが届くよう、次の順番で送る
          setTimeout(() => {
            this.pushFolder();
            if (this.uses.has("timetable")) this.pushTimetable();
          }, 0);
        }
        return { apiVersion: this.view.manifest.apiVersion, viewId: this.view.manifest.id, tabId: this.tab.tabId, theme: this.tab.theme() };
      case "open":
        return this.tab.open({ id: p.id, path: p.path }, this.toWindowRect(p.from), p.newTab === true);
      case "navigate":
        return this.tab.navigate(p.path);
      case "navigateUp":
        return this.tab.navigateUp();
      case "trash":
        return { trashed: await this.tab.trash(p.items, this.toWindowRect(p.from)) };
      case "storage.get":
        return store.get(p.key);
      case "storage.set": {
        const bad = checkStorageValue(p.value);
        if (bad) throw new HostError(bad);
        return store.set(p.key, p.value);
      }
      case "storage.delete":
        return store.delete(p.key);
      case "storage.keys":
        return store.keys();
      // フォルダの中に置くデータ（ADR 0022）。書けないフォルダ（C:\ の直下など）なら、このビューの保存場所に置く
      case "folderData.get": {
        const text = await backend.folderDataRead(p.folder, this.folderDataName()).catch(() => null);
        if (text) {
          try {
            return JSON.parse(text);
          } catch {
            // 壊れていたら、無いことにする
          }
        }
        return store.get(this.folderDataKey(p.folder));
      }
      case "folderData.set": {
        const bad = checkStorageValue(p.value);
        if (bad) throw new HostError(bad);
        try {
          await backend.folderDataWrite(p.folder, this.folderDataName(), JSON.stringify(p.value));
          // 同じフォルダを開いている、ほかのウィンドウのビューに知らせる（ADR 0030）
          broadcast({ kind: "folderData", path: p.folder.path, name: this.folderDataName() });
          return store.delete(this.folderDataKey(p.folder));
        } catch (e) {
          // フォルダが無い・別のものに入れ替わった（ファイルID が違う）ときは、保存しない
          if (e instanceof BackendError && (e.apiError.code === "not-found" || e.apiError.message.startsWith("id does not match"))) throw e;
          return store.set(this.folderDataKey(p.folder), p.value);
        }
      }
      case "folderData.delete":
        await backend.folderDataDelete(p.folder, this.folderDataName()).catch(() => {});
        broadcast({ kind: "folderData", path: p.folder.path, name: this.folderDataName() });
        return store.delete(this.folderDataKey(p.folder));
      case "getTree":
        return this.buildTree(p.depth, p.from);
      case "resolve": {
        const found = await backend.resolve(p.refs);
        return found.map((r) => (r ? toEntry(r, this.uses) : null));
      }
      case "rename": {
        const bad = validateFileName(p.newName);
        if (bad) throw new HostError(bad);
        return toEntry(await this.tab.rename({ id: p.id, path: p.path }, p.newName), this.uses);
      }
      case "createFolder": {
        if (p.name !== undefined) {
          const bad = validateFileName(p.name);
          if (bad) throw new HostError(bad);
        }
        return toEntry(await this.tab.createFolder(p.name), this.uses);
      }
      case "showMenu": {
        const box = this.iframe.getBoundingClientRect();
        return { chosen: await this.tab.showMenu(box.x + p.x, box.y + p.y, p.items, p.extra ?? []) };
      }
      case "tags.list":
        return tagService.list();
      case "tags.create":
        return tagService.create(p.name, p.color);
      case "tags.update":
        // 渡されたものだけを patch に入れる（undefined のキーを作らない）
        return tagService.update(p.id, {
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.color !== undefined ? { color: p.color } : {}),
        });
      case "tags.delete":
        return tagService.delete(p.id);
      case "tags.assign":
        return tagService.assign(p.items, p.tagId, p.on);
      case "tags.entries":
        return (await tagService.entries(p.tagId)).map((r) => toEntry(r, this.uses));
      // 時間割は、このビューが開いているフォルダのもの（ADR 0012）
      case "timetable.get":
        return timetableService.get(this.folderRef());
      case "timetable.set":
        return timetableService.set(this.folderRef(), p.timetable);
      case "timetable.delete":
        return timetableService.delete(this.folderRef());
      case "timetable.current":
        return timetableService.current(this.folderRef());
      case "views.list":
        return this.tab.listViews();
      case "tabs.open":
        return this.tab.openTab(p.viewId, p.path, p.replace === true);
      case "quickAccess.list":
        return (await quickAccess.entries()).map((r) => toEntry(r, this.uses));
      case "quickAccess.pin":
        return quickAccess.pin(p.items);
      case "quickAccess.unpin":
        return quickAccess.unpin(p.items);
      case "recent.list":
        return (await recentItems.entries()).map((r) => toEntry(r, this.uses));
      case "clipboard.copy":
        return this.tab.clipboardSet(p.items, false);
      case "clipboard.cut":
        return this.tab.clipboardSet(p.items, true);
      case "clipboard.paste":
        return { count: await this.tab.clipboardPaste() };
      case "drag.start": {
        const box = this.iframe.getBoundingClientRect();
        return this.tab.dragStart(p.items, box.x + p.x, box.y + p.y, this.toWindowTargets(p.targets));
      }
      case "drag.targets":
        return this.tab.dragTargets(this.toWindowTargets(p.targets));
      case "drag.move": {
        const box = this.iframe.getBoundingClientRect();
        return this.tab.dragMove(box.x + p.x, box.y + p.y, p.ctrl, p.shift);
      }
      case "drag.end": {
        const box = this.iframe.getBoundingClientRect();
        return this.tab.dragEnd(box.x + p.x, box.y + p.y, p.ctrl, p.shift, p.cancel);
      }
      // ↓ 読み取りの API（ADR 0023）
      case "files.readText":
        return backend.fileReadText(p.item, p.offset, p.maxBytes);
      case "files.readBytes":
        return new Uint8Array(await backend.fileReadBytes(p.item, p.offset, p.length));
      case "files.url":
        return backend.fileUrl(p.item);
      case "files.info":
        return (await backend.fileProperties(p.items, [...INFO_PROPERTY_NAMES])).map((m) => (m ? toFileInfo(m) : null));
      case "files.properties":
        return backend.fileProperties(p.items, p.names);
      case "search.find": {
        const r = await backend.searchFind(p.folder, p.query, p.depth, p.limit);
        return { entries: r.entries.map((e) => toEntry(e, this.uses)), truncated: r.truncated };
      }
      case "search.stats": {
        const r = await backend.searchStats(p.folder, p.depth);
        return { ...r, largest: r.largest.map((e) => toEntry(e, this.uses)), newest: r.newest.map((e) => toEntry(e, this.uses)) };
      }
      case "system.drives":
        return backend.systemDrives();
      case "system.info":
        return backend.systemInfo();
      // ↓ 本体の画面を使う（ADR 0024）
      case "ui.toast":
        // 表示中のタブのビューだけ。続けて出しすぎないよう、0.3 秒に1回まで
        if (this.tab.isActive() && Date.now() - this.lastToast > 300) {
          this.lastToast = Date.now();
          this.tab.toast(p.text);
        }
        return;
      case "ui.status":
        return this.tab.setStatus(p.text);
      case "ui.tab":
        return this.tab.setTabLabel(p);
      case "ui.confirm":
      case "ui.ask":
      case "ui.choose":
        return this.modal<unknown>(() =>
          msg.method === "ui.confirm"
            ? confirmDialog(p.message, p.okLabel ?? "OK")
            : msg.method === "ui.ask"
              ? askDialog(p as { label: string })
              : chooseDialog(p.title ?? this.view.manifest.name, p.items),
        );
      case "settings.get":
        return settingsService.get(this.view.manifest.id, this.view.manifest.settings ?? []);
      case "commands.set":
        this.commands = p.commands;
        return;
      // ↓ 本体が代わりに通信する（ADR 0027）。どの MOD からかは、本体が知っている id を渡す（MOD に言わせない）
      case "net.fetch": {
        const body = p.body === undefined ? undefined : typeof p.body === "string" ? new TextEncoder().encode(p.body) : (p.body as Uint8Array);
        const buf = await backend.netFetch(this.view.manifest.id, {
          url: p.url,
          method: p.method,
          headers: p.headers,
          ...(body ? { bodyBase64: bytesToBase64(body) } : {}),
          ...(p.secret ? { secret: p.secret } : {}),
        });
        return parseNetFrame(buf);
      }
      case "net.url":
        return backend.netUrl(this.view.manifest.id, p.url, p.secret);
      // ↓ 書き込みとコレクション（ADR 0025）
      case "files.create": {
        await this.ensureGrant("createFiles", "新しいファイル・フォルダを作ろうとしています");
        const base64 = p.bytes ? bytesToBase64(p.bytes as Uint8Array) : undefined;
        return toEntry(await backend.createEntry(p.folder, p.name, p.kind, p.text, base64), this.uses);
      }
      case "files.createShortcut":
        await this.ensureGrant("createFiles", "ショートカットを作ろうとしています");
        return toEntry(await backend.createShortcut(p.folder, p.target, p.name), this.uses);
      case "collections.list":
        await collectionService.load();
        return collectionService.list();
      case "collections.create":
        return collectionService.create(p.name, p.color);
      case "collections.update":
        return collectionService.update(p.id, p);
      case "collections.delete": {
        const name = collectionService.name(p.id);
        if (name === null) throw new HostError({ code: "not-found", message: `collection ${p.id}` });
        const ok = await this.modal(() => confirmDialog(`コレクション「${name}」を消しますか？\n中のファイル・フォルダは消えません。`, "消す"));
        if (!ok) throw new HostError({ code: "denied", message: "cancelled" });
        return collectionService.delete(p.id);
      }
      case "collections.add":
        return collectionService.add(p.id, p.items);
      case "collections.remove":
        return collectionService.remove(p.id, p.items);
      case "collections.entries": {
        const r = await collectionService.entries(p.id);
        return { entries: r.found.map((e) => toEntry(e, this.uses)), missing: r.missing };
      }
      case "mods.list":
        return this.tab.mods.list();
      case "mods.install":
        return { id: await this.tab.mods.install() };
      case "mods.remove":
        return this.tab.mods.remove(p.id);
      case "mods.addDev":
        return { dir: await this.tab.mods.addDev() };
      case "mods.createDev":
        return { dir: await this.tab.mods.createDev(p.name) };
      case "mods.pack":
        return { path: await this.tab.mods.pack(p.id) };
      case "mods.openFolder":
        return this.tab.mods.openFolder(p.id);
      case "mods.openDocs":
        return this.tab.mods.openDocs();
      case "mods.openDevtools":
        return this.tab.mods.openDevtools();
      case "mods.openSettings":
        return this.tab.mods.openSettings(p.id);
      // ↓ ログ（ADR 0029）
      case "logs.list":
        return logService.list(p.source);
      case "logs.sources":
        return logService.sources();
      case "logs.clear":
        return logService.clear(p.source);
    }
  }

  private async buildTree(depth: number, from?: EntryRef): Promise<TreeNode> {
    let root = this.folder;
    // from があれば、そのフォルダから下（ADR 0032）。ID が今のものと完全に合うときだけ読む（ほかの API の verify と同じ）。
    // 空の ID で確かめを飛ばせると、MOD がパスを書くだけで、本体から渡されていないフォルダの形まで読めてしまう。
    // ID の無いドライブ（FAT の USB メモリなど）では、どちらも空なので通る
    if (from) {
      root = await backend.listDir(from.path);
      if (from.id !== root.id) throw new HostError({ code: "not-found", message: "folder id does not match" });
    }
    if (!root) throw new HostError({ code: "not-found", message: "no folder is open" });
    let budget = TREE_MAX_FOLDERS;
    const rootRaw: RawEntry = { id: root.id, name: root.name, path: root.path, isDir: true, hidden: false, size: 0, modified: 0 };
    const walk = async (raw: RawEntry, children: RawEntry[] | null, level: number): Promise<TreeNode> => {
      const node: TreeNode = { entry: toEntry(raw, this.uses) };
      if (!raw.isDir || level >= depth) return node;
      let list = children;
      if (!list) {
        if (budget-- <= 0) return node;
        try {
          list = (await backend.listDir(raw.path)).entries;
        } catch {
          return node;
        }
      }
      const byPath = new Map(list.map((r) => [r.path, r]));
      const kids: TreeNode[] = [];
      for (const c of sortEntries(list.map((r) => toEntry(r, NO_EXTRAS)))) {
        kids.push(await walk(byPath.get(c.path)!, null, level + 1));
      }
      node.children = kids;
      return node;
    };
    return walk(rootRaw, root.entries, 0);
  }
}
