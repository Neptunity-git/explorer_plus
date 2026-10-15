// フォルダの直下で起きた変化（ADR 0023）を、MOD に渡す形にまとめる。
// Windows は名前の変更を「前の名前（renamedFrom）」「後の名前（renamedTo）」の2つに分けて知らせることがあるので、組み合わせる。
// 同じ項目の「書き換わった」が続いたら、1つにする。
import type { FileChange } from "../api/types";

/** Rust から届く1件（kind に renamedFrom・renamedTo がある） */
export type RawChange = { kind: string; path: string; from?: string };

const nameOf = (path: string) => path.replace(/\\+$/, "").split("\\").pop() ?? path;

export function pairChanges(raw: readonly RawChange[]): FileChange[] {
  const out: FileChange[] = [];
  let from: string | null = null;
  const flushFrom = () => {
    // 後の名前が来なかった「前の名前」は、フォルダの外へ動いた＝消えた
    if (from !== null) out.push({ kind: "removed", path: from, name: nameOf(from) });
    from = null;
  };
  for (const c of raw) {
    if (c.kind === "renamedFrom") {
      flushFrom();
      from = c.path;
      continue;
    }
    if (c.kind === "renamedTo") {
      if (from !== null) out.push({ kind: "renamed", path: c.path, name: nameOf(c.path), from });
      // 前の名前が無い「後の名前」は、フォルダの外から来た＝作られた
      else out.push({ kind: "created", path: c.path, name: nameOf(c.path) });
      from = null;
      continue;
    }
    flushFrom();
    if (c.kind === "renamed") {
      out.push({ kind: "renamed", path: c.path, name: nameOf(c.path), ...(c.from ? { from: c.from } : {}) });
    } else if (c.kind === "created" || c.kind === "removed" || c.kind === "modified") {
      const last = out[out.length - 1];
      if (c.kind === "modified" && last && last.path === c.path && (last.kind === "modified" || last.kind === "created")) continue;
      out.push({ kind: c.kind, path: c.path, name: nameOf(c.path) });
    }
  }
  flushFrom();
  return out;
}
