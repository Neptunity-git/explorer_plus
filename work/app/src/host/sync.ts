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
  | { kind: "log"; entry: import("../api/types").LogEntry };

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

export function onSync(cb: (msg: SyncMessage) => void): void {
  void listen<{ from: string; msg: SyncMessage }>(EVENT, (e) => {
    if (e.payload.from !== label) cb(e.payload.msg);
  }).catch(() => {});
}
