// Rust から届いた一覧を、ビューに渡す形（Entry・FolderSnapshot）にする。
// ビューが manifest の uses で宣言した情報だけを入れる（ADR 0002 判断4）。
import type { Entry, FolderSnapshot, Use } from "../api/types";
import { extOf, iconKindFor, sortEntries } from "../core/entries";
import { ICON_ORIGIN, type RawEntry, type RawFolder } from "./backend";
import { tagService } from "./tag-service";

/** ファイルごとにアイコンの絵が違う拡張子（Rust の icons.rs の PER_FILE_EXTS と同じ） */
const PER_FILE_ICON_EXTS = new Set(["exe", "lnk", "ico", "url", "msi", "cur", "ani"]);

export function iconUrlFor(raw: RawEntry, ext: string, size = 32): string {
  const kind = iconKindFor(raw.isDir ? "folder" : "file", ext);
  if (kind !== "system") return `${ICON_ORIGIN}/kind/${kind}.svg`;
  if (raw.isDir) return `${ICON_ORIGIN}/ext/folder?size=${size}`;
  if (PER_FILE_ICON_EXTS.has(ext)) return `${ICON_ORIGIN}/file?path=${encodeURIComponent(raw.path)}&size=${size}`;
  return `${ICON_ORIGIN}/ext/${ext || "file"}?size=${size}`;
}

/** folderSizes：フォルダのパス → 合計の大きさ（計算済みのものだけ） */
export function toEntry(raw: RawEntry, uses: ReadonlySet<Use>, folderSizes?: ReadonlyMap<string, number>): Entry {
  const kind = raw.isDir ? "folder" : "file";
  const ext = raw.isDir ? "" : extOf(raw.name);
  const e: Entry = { id: raw.id, name: raw.name, path: raw.path, kind, ext, hidden: raw.hidden };
  if (kind === "file" && uses.has("size")) e.size = raw.size;
  if (kind === "folder" && uses.has("folderSize")) {
    const s = folderSizes?.get(raw.path);
    if (s !== undefined) e.size = s;
  }
  if (uses.has("modified")) e.modified = raw.modified;
  if (uses.has("icons")) {
    e.iconKind = iconKindFor(kind, ext);
    e.iconUrl = iconUrlFor(raw, ext);
  }
  if (uses.has("tags")) e.tags = tagService.tagsOf({ id: raw.id, path: raw.path });
  return e;
}

export function toSnapshot(
  folder: RawFolder,
  uses: ReadonlySet<Use>,
  folderSizes?: ReadonlyMap<string, number>,
): FolderSnapshot {
  const entries = uses.has("entries") ? sortEntries(folder.entries.map((r) => toEntry(r, uses, folderSizes))) : [];
  return { path: folder.path, name: folder.name, parentPath: folder.parentPath, entries };
}
