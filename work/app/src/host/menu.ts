// 右クリックのメニュー（ADR 0009 判断2）。本体が描くので、どのビューでも同じ見た目・同じ中身になる。
// 透明な幕を画面全体（ビューの iframe の上も）に敷き、メニューの外をクリックしたら閉じる。

import { blockBackground } from "./effects";

export type MenuCommand = { label: string; shortcut?: string; disabled?: boolean; run: () => void };
export type MenuLine = MenuCommand | "separator";

/** メニューを (x, y)（本体の画面の座標）に出す。項目が選ばれるか、閉じられたら終わる */
export function showMenu(x: number, y: number, lines: MenuLine[]): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    // フォーカスを受け取れるようにする（ビューの iframe からキーボードの操作をメニューに移すため）
    menu.tabIndex = -1;
    const buttons: HTMLButtonElement[] = [];
    // 閉じたら、開く前にフォーカスがあった所（たいていビューの iframe）に戻す
    const previous = document.activeElement as HTMLElement | null;
    const unblock = blockBackground();

    const close = (then?: () => void) => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      backdrop.remove();
      unblock();
      previous?.focus();
      resolve();
      then?.();
    };

    for (const line of lines) {
      if (line === "separator") {
        // 先頭・末尾・連続の区切りは出さない
        if (menu.lastElementChild && !menu.lastElementChild.classList.contains("menu-sep")) {
          menu.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
        }
        continue;
      }
      const b = document.createElement("button");
      b.className = "menu-item";
      b.setAttribute("role", "menuitem");
      b.disabled = !!line.disabled;
      b.append(Object.assign(document.createElement("span"), { className: "menu-label", textContent: line.label }));
      if (line.shortcut) b.append(Object.assign(document.createElement("span"), { className: "menu-key", textContent: line.shortcut }));
      b.onclick = () => close(line.run);
      b.onmouseenter = () => b.focus();
      menu.appendChild(b);
      if (!b.disabled) buttons.push(b);
    }
    if (menu.lastElementChild?.classList.contains("menu-sep")) menu.lastElementChild.remove();

    const onKey = (e: KeyboardEvent) => {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
      else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onBlur = () => close();

    backdrop.onmousedown = (e) => e.target === backdrop && close();
    backdrop.oncontextmenu = (e) => {
      e.preventDefault();
      if (e.target === backdrop) close();
    };
    backdrop.appendChild(menu);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);

    // まず (x, y) に置いて測り、画面からはみ出していたら左・上に回す
    Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
    const r = menu.getBoundingClientRect();
    const right = document.documentElement.clientWidth - 4;
    const bottom = document.documentElement.clientHeight - 4;
    if (r.right > right) menu.style.left = `${Math.max(4, Math.min(x - r.width, right - r.width))}px`;
    if (r.bottom > bottom) menu.style.top = `${Math.max(4, Math.min(y - r.height, bottom - r.height))}px`;
    menu.focus();
  });
}
