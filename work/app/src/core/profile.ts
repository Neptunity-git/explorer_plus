// 自分の表示名とアイコン（ADR 0040）。本体で1つ決め、identity.get を許可した MOD に渡す。
// MOD を通じて、共有フォルダの向こうの人にも見えることがあるので、短い1行の文字だけにする。
import { PROFILE_ICON_MAX, PROFILE_NAME_MAX } from "../api/types";

export type Profile = { name: string | null; icon: string | null };

/** 改行・タブなどの制御文字（Cc）と、行・段落の区切り（Zl・Zp）を除き、前後の空白を取る。空なら null。長すぎる分は切る（文字は書記素ではなく、コードポイントで数える） */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = [...v.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "").trim()].slice(0, max).join("").trim();
  return s === "" ? null : s;
}

/** 保存したもの・入力されたものを、決まった形にする（壊れていれば、決めていないことにする） */
export function normalizeProfile(v: unknown): Profile {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { name: clean(o.name, PROFILE_NAME_MAX), icon: clean(o.icon, PROFILE_ICON_MAX) };
}
