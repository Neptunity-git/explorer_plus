// explorer_plus の TUI 風の部品（ADR 0011・0013）。見た目は tui.css、操作はマウスが主でキーボードも使える。
// MOD から使うとき：import { ask, pick, pickColor, confirm, button } from "/__runtime/tui.js";
//   （tui.css も読み込むこと：<link rel="stylesheet" href="/__runtime/tui.css">）

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** TUI 風のボタン。[ 文字 ] の形 */
export function button(label, onClick, { title, accent = false } = {}) {
  const b = el("button", `tui-button${accent ? " is-accent" : ""}`, label);
  if (title) b.title = title;
  b.onclick = (e) => {
    e.stopPropagation();
    onClick(e);
  };
  return b;
}

/** 画面の下に、1行の入力欄を出す。OK・Enter で文字、キャンセル・Esc・外側のクリックで null */
export function ask({ label, value = "", okLabel = "OK", placeholder = "" }) {
  return new Promise((resolve) => {
    const bar = el("div", "tui-ask");
    const input = el("input", "tui-input");
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    const done = (v) => {
      bar.remove();
      resolve(v);
    };
    bar.append(el("span", "tui-ask-label", label), input, button(okLabel, () => done(input.value), { accent: true }), button("キャンセル", () => done(null)));
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") done(null);
    };
    document.body.appendChild(bar);
    input.focus();
    input.select();
  });
}

/** 一覧から1つ選ぶ。items: [{ label, value, hint? }]。選ばなければ null */
export function pick({ title, items, empty = "なし" }) {
  return new Promise((resolve) => {
    const shade = el("div", "tui-shade");
    const box = el("div", "tui-box tui-pick");
    box.append(el("span", "tui-box-title", title));
    const list = el("div", "tui-scroll");
    list.tabIndex = 0;
    let cursor = 0;
    const done = (v) => {
      shade.remove();
      resolve(v);
    };
    const paint = () => [...list.children].forEach((r, i) => r.classList.toggle("is-selected", i === cursor));
    if (items.length === 0) list.append(el("div", "tui-row tui-dim", empty));
    items.forEach((it, i) => {
      const row = el("div", "tui-row");
      row.append(el("span", "tui-grow", it.label));
      if (it.hint) row.append(el("span", "tui-dim", it.hint));
      row.onmouseenter = () => {
        cursor = i;
        paint();
      };
      row.onclick = () => done(it.value);
      list.append(row);
    });
    const foot = el("div", "tui-pick-foot");
    foot.append(button("キャンセル", () => done(null)));
    box.append(list, foot);
    shade.append(box);
    shade.onclick = (e) => e.target === shade && done(null);
    list.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "j") cursor = Math.min(items.length - 1, cursor + 1);
      else if (e.key === "ArrowUp" || e.key === "k") cursor = Math.max(0, cursor - 1);
      else if (e.key === "Enter" && items[cursor]) return done(items[cursor].value);
      else if (e.key === "Escape") return done(null);
      else return;
      e.preventDefault();
      paint();
      list.children[cursor]?.scrollIntoView({ block: "nearest" });
    };
    document.body.appendChild(shade);
    paint();
    list.focus();
  });
}

/** よく使う色の並び（タグの色など） */
export const PALETTE = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];

/** 色を選ぶ。色の見本を押すか、#rrggbb を入れる。やめたら null */
export function pickColor({ title = "色", value = PALETTE[0] } = {}) {
  return new Promise((resolve) => {
    const shade = el("div", "tui-shade");
    const box = el("div", "tui-box tui-pick");
    box.append(el("span", "tui-box-title", title));
    const done = (v) => {
      shade.remove();
      resolve(v);
    };
    const swatches = el("div", "tui-swatches");
    for (const c of PALETTE) {
      const s = el("button", `tui-swatch${c === value ? " is-current" : ""}`);
      s.style.background = c;
      s.title = c;
      s.onclick = () => done(c);
      swatches.append(s);
    }
    const custom = el("div", "tui-swatch-row");
    const picker = el("input");
    picker.type = "color";
    picker.value = /^#[0-9a-f]{6}$/i.test(value) ? value : PALETTE[0];
    const hex = el("input", "tui-input");
    hex.value = value;
    hex.style.width = "10ch";
    picker.oninput = () => (hex.value = picker.value);
    hex.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(hex.value.trim());
      if (e.key === "Escape") done(null);
    };
    custom.append(el("span", "tui-dim", "自由に："), picker, hex, button("この色にする", () => done(hex.value.trim()), { accent: true }));
    const foot = el("div", "tui-pick-foot");
    foot.append(button("キャンセル", () => done(null)));
    box.append(swatches, custom, foot);
    shade.append(box);
    shade.onclick = (e) => e.target === shade && done(null);
    document.body.appendChild(shade);
    swatches.querySelector("button")?.focus();
  });
}

/** 確かめる。「はい」で true */
export function confirm({ message, okLabel = "はい" }) {
  return new Promise((resolve) => {
    const bar = el("div", "tui-ask");
    const done = (v) => {
      bar.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
    };
    const ok = button(okLabel, () => done(true), { accent: true });
    bar.append(el("span", "tui-ask-label tui-warn", message), ok, button("やめる", () => done(false)));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(bar);
    ok.focus();
  });
}
