export type Crumb = { label: string; path: string };

const DRIVE_RE = /^[A-Za-z]:/;

export function splitPath(path: string): Crumb[] {
  if (!DRIVE_RE.test(path)) {
    return [];
  }

  const drive = path[0].toUpperCase() + ":";
  const crumbs: Crumb[] = [{ label: drive, path: drive + "\\" }];

  const rest = path.slice(2);
  const parts = rest.split("\\").filter((p) => p.length > 0);

  let acc = drive + "\\";
  for (const part of parts) {
    acc = acc + part;
    crumbs.push({ label: part, path: acc });
  }

  return crumbs;
}

export function parseCommandLine(
  text: string
): { file: string; args: string } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed[0] === '"') {
    const close = trimmed.indexOf('"', 1);
    if (close === -1) {
      return null;
    }
    const file = trimmed.slice(1, close);
    if (file.length === 0) {
      return null;
    }
    const args = trimmed.slice(close + 1).trim();
    return { file, args };
  }

  const m = trimmed.match(/^[ \t]*/);
  const start = m ? m[0].length : 0;
  const rest = trimmed.slice(start);
  const idx = rest.search(/[ \t]/);
  let file: string;
  let args: string;
  if (idx === -1) {
    file = rest;
    args = "";
  } else {
    file = rest.slice(0, idx);
    args = rest.slice(idx).trim();
  }
  if (file.length === 0) {
    return null;
  }
  return { file, args };
}
