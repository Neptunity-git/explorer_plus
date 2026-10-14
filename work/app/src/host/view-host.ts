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
  type Rect,
  type TreeNode,
  type Use,
} from "../api/types";
import { sortEntries } from "../core/entries";
import { parseModMessage } from "../core/protocol";
import { checkPermission, checkStorageValue } from "../core/permission";
import { backend, BackendError, MOD_ORIGIN, toApiError, type RawEntry, type RawFolder } from "./backend";
import { toEntry, toSnapshot } from "./snapshot";
import { storageFor } from "./view-storage";

export type LoadedView = { manifest: Manifest; source: "builtin" | "user" };

/** ビューが本体（タブ）に頼めること。画面上の位置は、本体の画面の座標に直してから渡す */
export interface TabActions {
  readonly tabId: string;
  theme(): "light" | "dark";
  navigate(path: string): Promise<void>;
  navigateUp(): Promise<void>;
  open(ref: EntryRef, from?: Rect): Promise<void>;
  trash(refs: EntryRef[], from?: Rect): Promise<number>;
  shortcut(key: KeyMessage): void;
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
    this.iframe.title = view.manifest.name;
    this.iframe.src = `${MOD_ORIGIN}/${view.manifest.id}/__frame.html`;
    window.addEventListener("message", this.onMessage);
    container.appendChild(this.iframe);
  }

  destroy() {
    this.generation++;
    window.removeEventListener("message", this.onMessage);
    this.iframe.remove();
  }

  focus() {
    this.iframe.focus();
  }

  /** タブのフォルダが変わった（または読み直した）ときに呼ぶ */
  setFolder(folder: RawFolder) {
    this.folder = folder;
    this.generation++;
    if (this.isReady) this.pushFolder();
  }

  setTheme(theme: "light" | "dark") {
    if (this.isReady) this.post({ ep: PROTOCOL_VERSION, kind: "event", event: "theme", data: theme });
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
    const denied = checkPermission(this.view.manifest.uses, msg.method);
    if (denied) {
      this.reply(msg.id, Promise.reject(new HostError(denied)));
      return;
    }
    this.reply(msg.id, this.dispatch(msg));
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
          // 返事が届いた後にフォルダが届くよう、次の順番で送る
          setTimeout(() => this.pushFolder(), 0);
        }
        return { apiVersion: this.view.manifest.apiVersion, viewId: this.view.manifest.id, tabId: this.tab.tabId, theme: this.tab.theme() };
      case "open":
        return this.tab.open({ id: p.id, path: p.path }, this.toWindowRect(p.from));
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
      case "getTree":
        return this.buildTree(p.depth);
      case "resolve": {
        const found = await backend.resolve(p.refs);
        return found.map((r) => (r ? toEntry(r, this.uses) : null));
      }
    }
  }

  private async buildTree(depth: number): Promise<TreeNode> {
    if (!this.folder) throw new HostError({ code: "not-found", message: "no folder is open" });
    const root = this.folder;
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
