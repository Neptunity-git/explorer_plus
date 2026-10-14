import type { EntryRef } from "../api/types";
import { sameRef } from "./tags";

/**
 * クイックアクセス（ピン留めしたフォルダ）と、最近使った項目（ADR 0014 判断2・3）の
 * 一覧を扱う純粋関数。どの関数も引数の配列を書き換えず、新しい配列を返す。
 */

/**
 * `refs` の各 ref を順に、`list` に同じもの（sameRef）が無ければ最後に足す。
 * あれば、その位置のまま ref を引数のものに置き換える（パスを新しくするため）。
 * `refs` の中で重なっているもの（sameRef）は、最初の1つだけを扱う。
 */
export function pinRefs(list: readonly EntryRef[], refs: readonly EntryRef[]): EntryRef[] {
  const result: EntryRef[] = list.map((r) => ({ ...r }));
  const seen: EntryRef[] = [];
  for (const ref of refs) {
    if (seen.some((s) => sameRef(s, ref))) continue;
    seen.push(ref);
    const idx = result.findIndex((r) => sameRef(r, ref));
    if (idx === -1) {
      result.push({ ...ref });
    } else {
      result[idx] = { ...ref };
    }
  }
  return result;
}

/**
 * `refs` のどれかと sameRef が真になる要素を除く。
 */
export function unpinRefs(list: readonly EntryRef[], refs: readonly EntryRef[]): EntryRef[] {
  return list.filter((r) => !refs.some((ref) => sameRef(r, ref))).map((r) => ({ ...r }));
}

/**
 * `list` から ref と sameRef が真になる要素を除き、ref を先頭に置き、
 * 長さが `max` を超えたら後ろを切る（`max` 個まで残す）。
 */
export function pushRecent(list: readonly EntryRef[], ref: EntryRef, max: number): EntryRef[] {
  const rest = list.filter((r) => !sameRef(r, ref)).map((r) => ({ ...r }));
  return [{ ...ref }, ...rest].slice(0, max);
}
