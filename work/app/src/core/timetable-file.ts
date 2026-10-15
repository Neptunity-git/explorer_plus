// 学校のフォルダの中に置く時間割のファイル（.explorer_plus/timetable.json。ADR 0022）の形。
// 別の PC（OneDrive などで同期した先）でも使えるように、学校のフォルダの中のフォルダは「学校のフォルダからの相対パス」で書き、
// ファイルID は書かない（ファイルID は PC ごとに違うため）。学校のフォルダの外のフォルダは、パスをそのまま書く。
import type { EntryRef, Timetable } from "../api/types";

export const TIMETABLE_FILE_VERSION = 1;

export type TimetableFile = { v: number; timetable: Timetable };

/** a が b の中（または同じ）なら、b からの相対パス（同じなら ""）。そうでなければ null。大文字・小文字は区別しない */
export function relativeTo(path: string, base: string): string | null {
  const p = path.replace(/\\+$/, "");
  const b = base.replace(/\\+$/, "");
  if (p.toLowerCase() === b.toLowerCase()) return "";
  if (p.toLowerCase().startsWith(b.toLowerCase() + "\\")) return p.slice(b.length + 1);
  return null;
}

/** 絶対パス（ドライブ文字か \\ で始まる）か */
function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path) || path.startsWith("\\\\");
}

function mapFolders(tt: Timetable, f: (r: EntryRef) => EntryRef): Timetable {
  return {
    ...tt,
    slots: tt.slots.map((s) => ({ ...s, folders: s.folders.map(f) })),
    ...(tt.ondemand ? { ondemand: tt.ondemand.map((o) => ({ ...o, folders: o.folders.map(f) })) } : {}),
  };
}

/** 保存する形へ：学校のフォルダの中のフォルダは相対パスに、ファイルID は空に */
export function toTimetableFile(tt: Timetable, school: string): TimetableFile {
  return {
    v: TIMETABLE_FILE_VERSION,
    timetable: mapFolders(tt, (r) => {
      const rel = relativeTo(r.path, school);
      return { id: "", path: rel === null ? r.path : rel === "" ? "." : rel };
    }),
  };
}

/** 読み込んだ形から：相対パスを、この PC の学校のフォルダから見た絶対パスに戻す（ファイルID は空。呼ぶ側で引く） */
export function fromTimetableFile(file: unknown, school: string): unknown {
  if (!file || typeof file !== "object") return null;
  const tt = (file as { timetable?: unknown }).timetable;
  if (!tt || typeof tt !== "object") return null;
  const base = school.replace(/\\+$/, "");
  const fix = (r: unknown): unknown => {
    if (!r || typeof r !== "object" || typeof (r as EntryRef).path !== "string") return r;
    const path = (r as EntryRef).path;
    return { id: "", path: isAbsolute(path) ? path : path === "." ? base : `${base}\\${path.replace(/\//g, "\\")}` };
  };
  const t = tt as Record<string, unknown>;
  const fixList = (list: unknown) => (Array.isArray(list) ? list.map((x) => (x && typeof x === "object" ? { ...(x as object), folders: Array.isArray((x as { folders?: unknown }).folders) ? (x as { folders: unknown[] }).folders.map(fix) : (x as { folders?: unknown }).folders } : x)) : list);
  return { ...t, slots: fixList(t.slots), ...(t.ondemand !== undefined ? { ondemand: fixList(t.ondemand) } : {}) };
}
