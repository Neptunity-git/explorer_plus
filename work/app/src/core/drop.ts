function normalizeDriveRoot(p: string): string {
  let s = p.replace(/\\+$/, "");
  if (/^[A-Za-z]:$/.test(s)) {
    s = s + "\\";
  }
  return s.toLowerCase();
}

function parentFolder(p: string): string {
  let s = p.replace(/\\+$/, "");
  const idx = s.lastIndexOf("\\");
  if (idx === -1) {
    return "";
  }
  const parent = s.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) {
    return parent + "\\";
  }
  return parent;
}

export function isSameOrInside(path: string, folder: string): boolean {
  const p = normalizeDriveRoot(path);
  const f = normalizeDriveRoot(folder);
  if (p === f) {
    return true;
  }
  if (f.endsWith("\\")) {
    return p.startsWith(f);
  }
  return p.startsWith(f + "\\");
}

export function dropEffect(
  sources: readonly string[],
  dest: string,
  keys: { ctrl: boolean; shift: boolean },
): "move" | "copy" | null {
  if (sources.length === 0) {
    return null;
  }

  for (const source of sources) {
    if (isSameOrInside(dest, source)) {
      return null;
    }
  }

  for (const source of sources) {
    const parent = parentFolder(source);
    if (parent.toLowerCase() === normalizeDriveRoot(dest) && !keys.ctrl) {
      return null;
    }
  }

  if (keys.ctrl) {
    return "copy";
  }
  if (keys.shift) {
    return "move";
  }

  const first = sources[0];
  const srcDrive = first.charAt(0).toUpperCase();
  const destDrive = dest.charAt(0).toUpperCase();
  return srcDrive === destDrive ? "move" : "copy";
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = list.slice();
  if (from < 0 || to < 0 || from >= copy.length || to >= copy.length) {
    return copy;
  }
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
