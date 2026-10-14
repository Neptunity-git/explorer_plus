import type { Entry, IconKind } from "../api/types";

const LAUNCH_EXTS = new Set(["exe", "bat", "cmd", "lnk", "msi"]);
const CONFIG_EXTS = new Set(["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml"]);

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function iconKindFor(kind: "file" | "folder", ext: string): IconKind {
  if (kind === "folder") return "system";
  if (LAUNCH_EXTS.has(ext)) return "launch";
  if (CONFIG_EXTS.has(ext)) return "config";
  return "system";
}

export function sortEntries(entries: readonly Entry[]): Entry[] {
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => {
    const kindDiff = (a.entry.kind === "folder" ? 0 : 1) - (b.entry.kind === "folder" ? 0 : 1);
    if (kindDiff !== 0) return kindDiff;
    const cmp = collator.compare(a.entry.name, b.entry.name);
    if (cmp !== 0) return cmp;
    if (a.entry.name < b.entry.name) return -1;
    if (a.entry.name > b.entry.name) return 1;
    return a.index - b.index;
  });
  return indexed.map((item) => item.entry);
}
