// MOD が本体に頼む画面（ADR 0024）：入力・選択・設定・コマンドの一覧。見た目は本体の確かめの画面と同じ。
// 設定の値は、アプリのデータ（settings）にビューごとに覚える。
import type { ChoiceItem, SettingDef, SettingValues } from "../api/types";
import { normalizeSettings, validSettingValue } from "../core/settings";
import { backend } from "./backend";
import { panel } from "./pickers";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, primary: boolean, run: () => void): HTMLButtonElement {
  const b = el("button", primary ? "primary" : undefined, text);
  b.onclick = run;
  return b;
}

/** 1行の入力。やめたら null */
export function askDialog(opts: { label: string; value?: string; placeholder?: string; okLabel?: string }): Promise<string | null> {
  const p = panel(opts.label);
  const input = el("input", "picker-input");
  input.value = opts.value ?? "";
  input.placeholder = opts.placeholder ?? "";
  input.maxLength = 500;
  p.body.appendChild(input);
  let result: string | null = null;
  const ok = () => {
    result = input.value;
    p.close();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ok();
  });
  p.footer.append(button(opts.okLabel ?? "OK", true, ok), button("やめる", false, p.close));
  input.focus();
  input.select();
  return p.done.then(() => result);
}

/** 一覧から1つ選ぶ。打つと絞り込める（Enter で一番上）。やめたら null */
export function chooseDialog(title: string, items: readonly ChoiceItem[]): Promise<string | null> {
  const p = panel(title);
  const filter = el("input", "picker-input");
  filter.placeholder = "打って絞り込む";
  const list = el("div", "picker-list");
  p.body.append(filter, list);
  let result: string | null = null;
  let shown: ChoiceItem[] = [];
  const pick = (id: string) => {
    result = id;
    p.close();
  };
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    shown = items.filter((it) => !q || it.label.toLowerCase().includes(q) || (it.hint ?? "").toLowerCase().includes(q));
    list.textContent = "";
    if (shown.length === 0) list.appendChild(el("div", "picker-empty", "見つかりません"));
    for (const it of shown) {
      const row = el("button", "picker-row");
      row.append(el("span", "picker-grow", it.label));
      if (it.hint) row.append(el("span", "picker-hint", it.hint));
      row.onclick = () => pick(it.id);
      list.appendChild(row);
    }
  };
  filter.addEventListener("input", render);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && shown[0]) pick(shown[0].id);
  });
  p.footer.append(button("やめる", false, p.close));
  render();
  filter.focus();
  return p.done.then(() => result);
}

/** 設定の画面。保存したら新しい値、やめたら null */
export function settingsDialog(title: string, defs: readonly SettingDef[], values: SettingValues): Promise<SettingValues | null> {
  const p = panel(title);
  const form = el("div", "settings-form");
  p.body.appendChild(form);
  const read: (() => unknown)[] = [];
  for (const d of defs) {
    const row = el("label", "settings-row");
    row.append(el("span", "settings-label", d.label));
    const v = values[d.key];
    let input: HTMLInputElement | HTMLSelectElement;
    if (d.type === "boolean") {
      const c = el("input");
      c.type = "checkbox";
      c.checked = v === true;
      read.push(() => c.checked);
      input = c;
    } else if (d.type === "choice") {
      const s = el("select", "picker-input");
      for (const o of d.options) {
        const opt = el("option", undefined, o.label);
        opt.value = o.value;
        s.appendChild(opt);
      }
      s.value = String(v);
      read.push(() => s.value);
      input = s;
    } else {
      const t = el("input", d.type === "color" ? undefined : "picker-input");
      t.type = d.type === "number" ? "number" : d.type === "color" ? "color" : "text";
      if (d.type === "number") {
        if (d.min !== undefined) t.min = String(d.min);
        if (d.max !== undefined) t.max = String(d.max);
        if (d.step !== undefined) t.step = String(d.step);
      }
      if (d.type === "text") t.maxLength = d.maxLength ?? 200;
      t.value = String(v);
      read.push(() => (d.type === "number" ? Number(t.value) : t.value));
      input = t;
    }
    row.append(input);
    form.appendChild(row);
  }
  const message = el("div", "picker-message");
  p.body.appendChild(message);
  let result: SettingValues | null = null;
  const save = () => {
    const next: SettingValues = {};
    for (let i = 0; i < defs.length; i++) {
      const value = read[i]();
      if (!validSettingValue(defs[i], value)) {
        message.textContent = `「${defs[i].label}」の値が範囲の外です`;
        return;
      }
      next[defs[i].key] = value as SettingValues[string];
    }
    result = next;
    p.close();
  };
  const reset = () => {
    result = normalizeSettings(defs, null);
    p.close();
  };
  p.footer.append(button("保存", true, save), button("既定に戻す", false, reset), button("やめる", false, p.close));
  return p.done.then(() => result);
}

// ---- 設定の値（ビューごと） ----

class SettingsService {
  private data: Record<string, unknown> = {};
  private loading: Promise<void> | null = null;
  private readonly listeners = new Map<string, Set<(v: SettingValues) => void>>();

  load(): Promise<void> {
    this.loading ??= backend
      .appDataLoad("settings")
      .then((text) => {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.data = parsed as Record<string, unknown>;
      })
      .catch(() => {});
    return this.loading;
  }

  async get(viewId: string, defs: readonly SettingDef[]): Promise<SettingValues> {
    await this.load();
    return normalizeSettings(defs, this.data[viewId]);
  }

  async set(viewId: string, values: SettingValues): Promise<void> {
    await this.load();
    this.data[viewId] = values;
    await backend.appDataSave("settings", JSON.stringify(this.data));
    for (const cb of this.listeners.get(viewId) ?? []) cb(values);
  }

  onChange(viewId: string, cb: (v: SettingValues) => void): () => void {
    const set = this.listeners.get(viewId) ?? new Set();
    set.add(cb);
    this.listeners.set(viewId, set);
    return () => set.delete(cb);
  }
}

export const settingsService = new SettingsService();
