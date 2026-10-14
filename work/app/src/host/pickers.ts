// 右クリックのメニューから開く、本体の小さな画面（ADR 0010）。
//   タグを付ける：選んだ項目に、タグを付けたり外したりする。新しいタグもここで作れる
//   時間割のコマに結びつける：選んだフォルダを、時間割のコマに結びつける
import type { EntryRef, Tag, TimetableSlot } from "../api/types";
import { sameRef } from "../core/tags";
import { BackendError } from "./backend";
import { blockBackground } from "./effects";
import { TAG_PALETTE, tagService } from "./tag-service";
import { timetableService } from "./timetable-service";

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 画面の中央に出す小さな画面の枠。close() で閉じる。Esc・外側のクリックでも閉じる */
function panel(title: string): { body: HTMLElement; footer: HTMLElement; close: () => void; done: Promise<void> } {
  const backdrop = el("div", "dialog-backdrop");
  const box = el("div", "dialog picker");
  box.setAttribute("role", "dialog");
  const head = el("h2", "picker-title", title);
  const body = el("div", "picker-body");
  const footer = el("div", "dialog-buttons");
  box.append(head, body, footer);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const previous = document.activeElement as HTMLElement | null;
  const unblock = blockBackground();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    unblock();
    previous?.focus();
    resolve();
  };
  document.addEventListener("keydown", onKey, true);
  backdrop.onmousedown = (e) => e.target === backdrop && close();
  return { body, footer, close, done };
}

function errorText(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.apiError.code === "exists") return "同じ名前のタグが既にあります。";
    if (e.apiError.code === "too-large") return "タグが多すぎます。";
    if (e.apiError.code === "invalid") return "タグの名前は1〜40文字にしてください。";
  }
  return e instanceof Error ? e.message : String(e);
}

/** 選んだ項目にタグを付ける・外す */
export function tagPicker(items: EntryRef[]): Promise<void> {
  const { body, footer, close, done } = panel(items.length === 1 ? "タグ" : `タグ（${items.length} 個の項目）`);
  const list = el("div", "picker-list");
  const input = el("input", "picker-input");
  input.placeholder = "新しいタグの名前を入れて Enter";
  const message = el("div", "picker-message");

  const state = (t: Tag): "on" | "off" | "some" => {
    const n = items.filter((r) => tagService.tagsOf(r).includes(t.id)).length;
    return n === 0 ? "off" : n === items.length ? "on" : "some";
  };
  const render = () => {
    list.textContent = "";
    if (tagService.list().length === 0) list.append(el("div", "picker-empty", "タグはまだありません。"));
    for (const t of tagService.list()) {
      const row = el("label", "picker-row");
      const box = el("input");
      box.type = "checkbox";
      const s = state(t);
      box.checked = s === "on";
      box.indeterminate = s === "some";
      box.onchange = () => {
        try {
          tagService.assign(items, t.id, box.checked);
        } catch (e) {
          message.textContent = errorText(e);
        }
        render();
      };
      const dot = el("span", "tag-dot");
      dot.style.background = t.color;
      row.append(box, dot, el("span", undefined, t.name));
      list.appendChild(row);
    }
  };
  input.onkeydown = (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    try {
      const color = TAG_PALETTE[tagService.list().length % TAG_PALETTE.length];
      const tag = tagService.create(input.value, color);
      tagService.assign(items, tag.id, true);
      input.value = "";
      message.textContent = "";
    } catch (err) {
      message.textContent = errorText(err);
    }
    render();
  };
  const ok = el("button", "primary", "閉じる");
  ok.onclick = close;
  footer.append(ok);
  body.append(list, input, message);
  render();
  input.focus();
  return done;
}

function slotLabel(s: TimetableSlot): string {
  const p = timetableService.get().periods.find((x) => x.id === s.periodId);
  return `${DAY_NAMES[s.day]} ${p ? `${p.label}（${p.start}〜${p.end}）` : s.periodId}　${s.title || "（授業名なし）"}`;
}

/** 選んだフォルダを、時間割のコマに結びつける */
export function slotPicker(folder: EntryRef, notify: (message: string) => void): Promise<void> {
  const tt = timetableService.get();
  const { body, footer, close, done } = panel("時間割のコマに結びつける");
  const order = (s: TimetableSlot) => s.day * 100 + tt.periods.findIndex((p) => p.id === s.periodId);
  const slots = [...tt.slots].sort((a, b) => order(a) - order(b));
  if (slots.length === 0) {
    body.append(el("div", "picker-empty", "コマがまだありません。時間割ビューで、授業のコマを作ってください。"));
  }
  for (const s of slots) {
    const linked = s.folders.some((f) => sameRef(f, folder));
    const row = el("button", "picker-row picker-choice", `${linked ? "✓ " : ""}${slotLabel(s)}`);
    row.onclick = async () => {
      const next = {
        ...tt,
        slots: tt.slots.map((x) => (x === s ? { ...x, folders: [folder] } : x)),
      };
      try {
        await timetableService.set(next);
        notify(`「${s.title || slotLabel(s)}」に結びつけました`);
        close();
      } catch (e) {
        notify(`結びつけられませんでした：${errorText(e)}`);
      }
    };
    body.appendChild(row);
  }
  const cancel = el("button", undefined, "閉じる");
  cancel.onclick = close;
  footer.append(cancel);
  // キーボードだけでも選べるように（Tab・Shift+Tab で移動、Enter で決定）
  (body.querySelector("button") ?? cancel).focus();
  return done;
}
