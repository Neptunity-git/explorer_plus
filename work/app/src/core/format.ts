const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatSize(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  let k = 0;
  let v = bytes;
  while (k < UNITS.length - 1 && v >= 1024) {
    v /= 1024;
    k += 1;
  }

  let num: string;
  if (v < 10) {
    const rounded = Math.round(v * 10) / 10;
    num = rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded);
  } else {
    num = String(Math.round(v));
  }

  return `${num} ${UNITS[k]}`;
}
