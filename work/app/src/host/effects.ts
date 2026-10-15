// 本体が出す確認の画面と、開く・ごみ箱のときの簡単な動き。
// 気持ちいいアニメーションは第2段階で作り込む（proposal.md）。ここではその出どころ（Rect）を受け取る形だけ用意する。
import type { Rect } from "../api/types";

/**
 * 確認の画面・メニューなどを開いている間、後ろ（タブ・アドレスバー・ビュー）を操作できなくする。
 * inert にすると、クリックもキーボードのフォーカスも届かなくなる（ビューの iframe も含めて）。戻す関数を返す
 */
export function blockBackground(): () => void {
  const app = document.getElementById("app");
  if (!app || app.inert) return () => {};
  app.inert = true;
  return () => {
    app.inert = false;
  };
}

/** 「はい」なら true。Enter で決定、Esc でやめる */
/** 確かめの画面。Enter（または confirmKey のキー）で決める、Esc でやめる */
export function confirmDialog(message: string, okLabel: string, confirmKey?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const text = document.createElement("p");
    text.textContent = message;
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = okLabel;
    const cancel = document.createElement("button");
    cancel.textContent = "やめる";
    buttons.append(ok, cancel);
    box.append(text, buttons);
    backdrop.appendChild(box);
    const previous = document.activeElement as HTMLElement | null;
    const unblock = blockBackground();
    document.body.appendChild(backdrop);
    const done = (v: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      unblock();
      previous?.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(false);
      } else if (confirmKey && e.key === confirmKey && !e.repeat) {
        e.preventDefault();
        done(true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    backdrop.onclick = (e) => e.target === backdrop && done(false);
    ok.focus();
  });
}

function ghost(from: Rect, className: string): HTMLDivElement {
  const g = document.createElement("div");
  g.className = `fx-ghost ${className}`;
  Object.assign(g.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.appendChild(g);
  return g;
}

/** 開くとき：その場所から光が広がる。起動を待たせないよう、呼んだらすぐ戻る（ADR 0003 判断2） */
export function playOpen(from?: Rect) {
  if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const g = ghost(from, "fx-open");
  g.animate(
    [
      { transform: "scale(1)", opacity: 0.9 },
      { transform: "scale(1.8)", opacity: 0 },
    ],
    { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" },
  ).onfinish = () => g.remove();
}

/** ごみ箱へ送るとき：その場所から縮みながら落ちる */
export function playTrash(from?: Rect) {
  if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const g = ghost(from, "fx-trash");
  g.animate(
    [
      { transform: "translateY(0) scale(1) rotate(0deg)", opacity: 1 },
      { transform: "translateY(40px) scale(0.2) rotate(-12deg)", opacity: 0 },
    ],
    { duration: 420, easing: "cubic-bezier(.5,0,.75,0)" },
  ).onfinish = () => g.remove();
}
