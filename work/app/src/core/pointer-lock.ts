// ポインターロック（マウスのポインターを画面に固定して、動いた量だけ受け取る。ADR 0039）。
// ロックそのものは、ブラウザ標準の requestPointerLock() を MOD が自分で呼ぶ。本体がするのは、iframe に許可を足すことと、
// 本体の画面に手が届かなくなる場面で、ロックを外してもらうことだけ。
import type { Use } from "../api/types";

/**
 * MOD の iframe の sandbox の値。allow-same-origin は付けない（ADR 0007 判断6）。
 * ポインターロックは、uses に "pointerLock" を宣言した MOD だけに許す。見えない所で動かす MOD（ADR 0036）には許さない
 * （画面に出ていないので、操作の元になるクリックも起きない）
 */
export function sandboxFor(uses: readonly Use[], background: boolean): string {
  return !background && uses.includes("pointerLock") ? "allow-scripts allow-pointer-lock" : "allow-scripts";
}

/**
 * 本体が確かめ・メニューなどの画面を出す呼びかけ。ロック中はポインターが消えて押せないので、先にロックを外してもらう
 * （clipboard.paste は、名前が重なったときに Windows の画面が出る。identity.get は、初めてのとき許可と表示名の画面が出る）
 */
export const OPENS_HOST_UI: ReadonlySet<string> = new Set([
  "ui.confirm",
  "ui.ask",
  "ui.choose",
  "showMenu",
  "trash",
  "collections.delete",
  "files.create",
  "files.createShortcut",
  "clipboard.paste",
  "identity.get",
]);
