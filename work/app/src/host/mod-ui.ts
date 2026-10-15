// MOD が本体に頼む画面（ADR 0024）：入力・選択・設定・コマンドの一覧。見た目は本体の確かめの画面と同じ。
// 設定の値は、アプリのデータ（settings）にビューごとに覚える。
import type { ChoiceItem, SettingDef, SettingValues } from "../api/types";
import { normalizeSettings, validSecretValue, validSettingValue } from "../core/settings";
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

/** 設定の画面で変えたもの。secrets は、新しく預ける値（null は消す）。書かなかった秘密の項目は入らない */
export type SettingsChange = { values: SettingValues; secrets: Record<string, string | null> };

/** 設定の画面。保存したら新しい値、やめたら null */
export function settingsDialog(title: string, defs: readonly SettingDef[], values: SettingValues): Promise<SettingsChange | null> {
  const p = panel(title);
  const form = el("div", "settings-form");
  p.body.appendChild(form);
  const read: (() => unknown)[] = [];
  const secrets: Record<string, string | null> = {};
  const secretInputs: { key: string; label: string; input: HTMLInputElement }[] = [];
  for (const d of defs) {
    const row = el("label", "settings-row");
    row.append(el("span", "settings-label", d.label));
    const v = values[d.key];
    let input: HTMLInputElement | HTMLSelectElement;
    if (d.type === "secret") {
      // 秘密の値（ADR 0027）：今の値は見せない。書いたときだけ預け直す
      const t = el("input", "picker-input");
      t.type = "password";
      t.autocomplete = "off";
      t.maxLength = 2000;
      t.placeholder = v === true ? "預けてあります" : "まだありません";
      const origin = d.send.origin;
      row.title = `本体が資格情報マネージャーに預け、${origin} に通信するときだけ付けます。ビューからは見えません`;
      secretInputs.push({ key: d.key, label: d.label, input: t });
      read.push(() => v === true);
      row.append(t);
      if (v === true) {
        const clear = button("消す", false, () => {
          secrets[d.key] = null;
          t.value = "";
          t.placeholder = "保存すると消します";
          clear.disabled = true;
        });
        clear.type = "button";
        row.append(clear);
      }
      form.appendChild(row);
      continue;
    }
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
  let result: SettingsChange | null = null;
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
    for (const s of secretInputs) {
      if (s.input.value === "") continue;
      if (!validSecretValue(s.input.value)) {
        message.textContent = `「${s.label}」は、英数字と記号（2000 文字まで）で入力してください`;
        return;
      }
      secrets[s.key] = s.input.value.trim();
    }
    result = { values: next, secrets };
    p.close();
  };
  // 既定に戻しても、預けた秘密の値はそのまま（消すときは「消す」）
  const reset = () => {
    result = { values: normalizeSettings(defs, null), secrets: {} };
    p.close();
  };
  p.footer.append(button("保存", true, save), button("既定に戻す", false, reset), button("やめる", false, p.close));
  return p.done.then(() => result);
}

// ---- 設定の値（ビューごと） ----

class SettingsService {
  private data: Record<string, unknown> = {};
  private readonly defs = new Map<string, readonly SettingDef[]>();
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

  /** 今の値。秘密の項目は「預けてあるか」（資格情報マネージャーに聞く） */
  async get(viewId: string, defs: readonly SettingDef[]): Promise<SettingValues> {
    await this.load();
    this.defs.set(viewId, defs);
    const values = normalizeSettings(defs, this.data[viewId]);
    const keys = defs.filter((d) => d.type === "secret").map((d) => d.key);
    if (keys.length > 0) {
      const has = await backend.secretStatus(viewId, keys).catch(() => keys.map(() => false));
      keys.forEach((k, i) => (values[k] = has[i]));
    }
    return values;
  }

  /** 値を覚える。秘密の値は資格情報マネージャーへ（settings のファイルには書かない） */
  async set(viewId: string, change: SettingsChange): Promise<void> {
    await this.load();
    const defs = this.defs.get(viewId) ?? [];
    const secretKeys = new Set(defs.filter((d) => d.type === "secret").map((d) => d.key));
    for (const [key, value] of Object.entries(change.secrets)) if (secretKeys.has(key)) await backend.secretSet(viewId, key, value);
    this.data[viewId] = Object.fromEntries(Object.entries(change.values).filter(([k]) => !secretKeys.has(k)));
    await backend.appDataSave("settings", JSON.stringify(this.data));
    const now = await this.get(viewId, defs);
    for (const cb of this.listeners.get(viewId) ?? []) cb(now);
  }

  /** ほかのウィンドウが保存した：読み直し、このウィンドウのビューに新しい値を知らせる */
  async reload() {
    this.loading = null;
    await this.load();
    for (const [viewId, set] of this.listeners) {
      if (set.size === 0) continue;
      const now = await this.get(viewId, this.defs.get(viewId) ?? []);
      for (const cb of set) cb(now);
    }
  }

  onChange(viewId: string, cb: (v: SettingValues) => void): () => void {
    const set = this.listeners.get(viewId) ?? new Set();
    set.add(cb);
    this.listeners.set(viewId, set);
    return () => set.delete(cb);
  }
}

export const settingsService = new SettingsService();
