// ウィンドウのあいだの知らせ（ADR 0030）。ウィンドウはそれぞれ、タグ・設定・最近使った項目などを自分の中に覚えているので、
// どれかのウィンドウで変えて保存したら、ほかのウィンドウに「変わった」と知らせ、ほかのウィンドウは読み直す。
// （自分が送ったものは受け取らない）
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type SyncMessage =
  /** アプリのデータ（tags・settings・recent など）を保存した */
  | { kind: "appData"; name: string }
  /** ビューごとの保存（ep.storage）を保存した */
  | { kind: "viewStorage"; viewId: string }
  /** 入っている MOD が変わった（入れた・外した・開発中の MOD を足した） */
  | { kind: "mods" }
  /** ログが1件増えた（ファイルへは、増やしたウィンドウが書く） */
  | { kind: "log"; entry: import("../api/types").LogEntry }
  /** タブをドラッグして、そのウィンドウの上に来た（to が null なら、どのウィンドウの上でもなくなった）。x・y は to のウィンドウの中の位置 */
  | { kind: "tabHover"; to: string | null; x: number; y: number }
  /** タブを、そのウィンドウへ移した（受け取ったウィンドウが、x の位置にタブを開く） */
  | { kind: "tabIn"; to: string; x: number; y: number; path?: string; view: string }
  /** フォルダの中のデータ（ノートなど。.explorer_plus/<name>）を書き換えた */
  | { kind: "folderData"; path: string; name: string };

const EVENT = "ep-sync";
let label = "main";
try {
  label = getCurrentWindow().label;
} catch {
  // 試験（Tauri の外）では使えない
}

/** このウィンドウの名前（最初のウィンドウは "main"） */
export const windowLabel = label;

export function broadcast(msg: SyncMessage) {
  void emit(EVENT, { from: label, msg }).catch(() => {});
}

const listeners = new Set<(msg: SyncMessage) => void>();
let listening = false;

/** ほかのウィンドウからの知らせを受け取る。返り値を呼ぶと、受け取るのをやめる（タブを閉じたときなど） */
export function onSync(cb: (msg: SyncMessage) => void): () => void {
  listeners.add(cb);
  if (!listening) {
    listening = true;
    void listen<{ from: string; msg: SyncMessage }>(EVENT, (e) => {
      if (e.payload.from === label) return;
      for (const f of listeners) f(e.payload.msg);
    }).catch(() => {});
  }
  return () => listeners.delete(cb);
}
