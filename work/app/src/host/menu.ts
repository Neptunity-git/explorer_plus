// 右クリックのメニュー（ADR 0009 判断2）。本体が描くので、どのビューでも同じ見た目・同じ中身になる。
// 透明な幕を画面全体（ビューの iframe の上も）に敷き、メニューの外をクリックしたら閉じる。
// 項目に submenu を持たせると、マウスを乗せたとき（→ キー・クリックでも）その右にもう1段のメニューを開く（ADR 0036）

import { blockBackground } from "./effects";

export type MenuCommand = { label: string; shortcut?: string; disabled?: boolean; run: () => void };
export type MenuSubmenu = { label: string; disabled?: boolean; submenu: MenuLine[] };
export type MenuLine = MenuCommand | MenuSubmenu | "separator";

/** マウスを乗せてから、横のメニューを開く・閉じるまでの時間（斜めに動かして隣の項目を通っても、閉じないように） */
const HOVER_MS = 150;

/** 1段分のメニュー。sub はこの段で横のメニューを開いている項目 */
type Level = { menu: HTMLDivElement; buttons: HTMLButtonElement[]; sub: HTMLButtonElement | null };

/** メニューを (x, y)（本体の画面の座標）に出す。項目が選ばれるか、閉じられたら終わる */
export function showMenu(x: number, y: number, lines: MenuLine[]): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";
    // 閉じたら、開く前にフォーカスがあった所（たいていビューの iframe）に戻す
    const previous = document.activeElement as HTMLElement | null;
    const unblock = blockBackground();
    const levels: Level[] = [];
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;

    const close = (then?: () => void) => {
      clearTimeout(hoverTimer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      backdrop.remove();
      unblock();
      previous?.focus();
      resolve();
      then?.();
    };

    /** depth 段目から深いメニューを閉じる */
    const closeFrom = (depth: number) => {
      while (levels.length > depth) levels.pop()!.menu.remove();
      if (levels[depth - 1]) levels[depth - 1].sub = null;
    };

    /** depth 段目の項目 b の横に、submenu を開く。focusFirst なら、その1つ目の項目へ */
    const openSub = (depth: number, b: HTMLButtonElement, submenu: MenuLine[], focusFirst: boolean) => {
      clearTimeout(hoverTimer);
      if (levels[depth].sub !== b) {
        closeFrom(depth + 1);
        levels[depth].sub = b;
        const r = b.getBoundingClientRect();
        const parent = levels[depth].menu.getBoundingClientRect();
        // メニューの枠と余白（5px）だけ上にずらし、横のメニューの1つ目の項目を、この項目にそろえる
        build(submenu, r.right + 2, r.top - 5, parent.left);
      }
      if (focusFirst) levels[depth + 1]?.buttons[0]?.focus();
    };

    /** 1段分のメニューを作って (x, y) に置く。右にはみ出すなら、flipX（親のメニューの左端）の左に回す */
    const build = (lines: MenuLine[], x: number, y: number, flipX?: number) => {
      const depth = levels.length;
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.setAttribute("role", "menu");
      // フォーカスを受け取れるようにする（ビューの iframe からキーボードの操作をメニューに移すため）
      menu.tabIndex = -1;
      const level: Level = { menu, buttons: [], sub: null };
      levels.push(level);
      // 横のメニューに入ったら、隣の項目を通ったときに仕掛けた「閉じる」を取り消す
      if (depth > 0) menu.onmouseenter = () => clearTimeout(hoverTimer);

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
        if ("submenu" in line) {
          b.setAttribute("aria-haspopup", "menu");
          b.append(Object.assign(document.createElement("span"), { className: "menu-arrow", textContent: "›" }));
          b.onclick = () => openSub(depth, b, line.submenu, true);
        } else {
          if (line.shortcut) b.append(Object.assign(document.createElement("span"), { className: "menu-key", textContent: line.shortcut }));
          b.onclick = () => close(line.run);
        }
        b.onmouseenter = () => {
          b.focus();
          clearTimeout(hoverTimer);
          if (level.sub === b) return;
          hoverTimer = setTimeout(() => {
            if ("submenu" in line && !b.disabled) openSub(depth, b, line.submenu, false);
            else closeFrom(depth + 1);
          }, HOVER_MS);
        };
        menu.appendChild(b);
        if (!b.disabled) level.buttons.push(b);
      }
      if (menu.lastElementChild?.classList.contains("menu-sep")) menu.lastElementChild.remove();
      backdrop.appendChild(menu);

      // まず (x, y) に置いて測り、画面からはみ出していたら左・上に回す
      Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
      const r = menu.getBoundingClientRect();
      const right = document.documentElement.clientWidth - 4;
      const bottom = document.documentElement.clientHeight - 4;
      if (r.right > right) menu.style.left = `${Math.max(4, flipX !== undefined ? flipX - r.width - 2 : Math.min(x - r.width, right - r.width))}px`;
      if (r.bottom > bottom) menu.style.top = `${Math.max(4, flipX !== undefined ? bottom - r.height : Math.min(y - r.height, bottom - r.height))}px`;
    };

    const onKey = (e: KeyboardEvent) => {
      // キーは、フォーカスのある段（無ければいちばん深い段）で扱う
      const found = levels.findIndex((l) => l.menu.contains(document.activeElement));
      const depth = found >= 0 ? found : levels.length - 1;
      const { buttons } = levels[depth];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const move = (to: HTMLButtonElement | undefined) => {
        closeFrom(depth + 1);
        to?.focus();
      };
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        // 横のメニューの中なら、それだけを閉じて、開いた項目に戻る
        if (depth > 0) {
          const opener = levels[depth - 1].sub;
          closeFrom(depth);
          opener?.focus();
        } else if (levels.length > 1) closeFrom(1);
        else if (e.key === "Escape") close();
        else return;
      } else if (e.key === "ArrowRight") {
        const b = buttons[i];
        if (!b || b.getAttribute("aria-haspopup") !== "menu") return;
        b.click();
      } else if (e.key === "ArrowDown") move(buttons[(i + 1) % buttons.length]);
      else if (e.key === "ArrowUp") move(buttons[(i - 1 + buttons.length) % buttons.length]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onBlur = () => close();

    // 中括弧で囲む：on〜 の関数が false を返すと、押したときの本来の動き（入力欄にカーソルが入る）が止まってしまう
    backdrop.onmousedown = (e) => {
      if (e.target === backdrop) close();
    };
    backdrop.oncontextmenu = (e) => {
      e.preventDefault();
      if (e.target === backdrop) close();
    };
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    build(lines, x, y);
    levels[0].menu.focus();
  });
}
