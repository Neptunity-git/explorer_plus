// MOD の設定（ADR 0024）。manifest の settings に項目を書くと、本体が設定の画面を作り、値を覚えておく。
// ここは、項目の決まりの検査と、覚えている値を「今の項目」に合わせる処理（壊れた値・消えた項目は既定に戻す）。
import type { SettingDef, SettingValues } from "../api/types";

export const SETTINGS_MAX = 30;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const label = (v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= 40;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 1つの値が、その項目に合うか */
export function validSettingValue(def: SettingDef, v: unknown): boolean {
  switch (def.type) {
    case "boolean":
      return typeof v === "boolean";
    case "number":
      return num(v) && (def.min === undefined || v >= def.min) && (def.max === undefined || v <= def.max);
    case "text":
      return typeof v === "string" && v.length <= (def.maxLength ?? 200);
    case "choice":
      return typeof v === "string" && def.options.some((o) => o.value === v);
    case "color":
      return typeof v === "string" && COLOR_RE.test(v);
  }
}

/** manifest の settings を確かめる。誤りは errors に足す */
export function checkSettings(raw: unknown, errors: string[]): SettingDef[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push("settings: must be an array");
    return undefined;
  }
  if (raw.length > SETTINGS_MAX) {
    errors.push(`settings: at most ${SETTINGS_MAX} items`);
    return undefined;
  }
  const out: SettingDef[] = [];
  const keys = new Set<string>();
  raw.forEach((s, i) => {
    const at = `settings[${i}]`;
    if (!isObj(s)) return void errors.push(`${at}: must be an object`);
    if (typeof s.key !== "string" || !KEY_RE.test(s.key)) return void errors.push(`${at}.key: letters, digits and _ (1-32, starting with a letter)`);
    if (keys.has(s.key)) return void errors.push(`${at}.key: "${s.key}" is used twice`);
    keys.add(s.key);
    if (!label(s.label)) return void errors.push(`${at}.label: 1-40 chars`);
    let def: SettingDef;
    switch (s.type) {
      case "boolean":
        def = { key: s.key, label: s.label as string, type: "boolean", default: s.default as boolean };
        break;
      case "number":
        if ((s.min !== undefined && !num(s.min)) || (s.max !== undefined && !num(s.max)) || (s.step !== undefined && !(num(s.step) && s.step > 0)))
          return void errors.push(`${at}: min, max and step must be numbers`);
        def = { key: s.key, label: s.label as string, type: "number", default: s.default as number, ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), ...(s.step !== undefined ? { step: s.step } : {}) };
        break;
      case "text":
        if (s.maxLength !== undefined && !(Number.isInteger(s.maxLength) && (s.maxLength as number) >= 1 && (s.maxLength as number) <= 200))
          return void errors.push(`${at}.maxLength: 1-200`);
        def = { key: s.key, label: s.label as string, type: "text", default: s.default as string, ...(s.maxLength !== undefined ? { maxLength: s.maxLength as number } : {}) };
        break;
      case "choice": {
        const opts = s.options;
        if (!Array.isArray(opts) || opts.length < 2 || opts.length > 30 || !opts.every((o) => isObj(o) && typeof o.value === "string" && o.value.length <= 60 && label(o.label)))
          return void errors.push(`${at}.options: 2-30 items of { value, label }`);
        def = { key: s.key, label: s.label as string, type: "choice", default: s.default as string, options: opts.map((o) => ({ value: o.value as string, label: o.label as string })) };
        break;
      }
      case "color":
        def = { key: s.key, label: s.label as string, type: "color", default: s.default as string };
        break;
      default:
        return void errors.push(`${at}.type: "boolean", "number", "text", "choice" or "color"`);
    }
    if (!validSettingValue(def, s.default)) return void errors.push(`${at}.default: does not fit the type`);
    out.push(def);
  });
  return out;
}

/** 覚えている値を、今の項目に合わせる（無い・合わない値は既定、項目に無い値は捨てる） */
export function normalizeSettings(defs: readonly SettingDef[], stored: unknown): SettingValues {
  const src = isObj(stored) ? stored : {};
  const out: SettingValues = {};
  for (const d of defs) out[d.key] = validSettingValue(d, src[d.key]) ? (src[d.key] as SettingValues[string]) : d.default;
  return out;
}
