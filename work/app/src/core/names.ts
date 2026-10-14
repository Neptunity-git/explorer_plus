import type { ApiError } from "../api/types";

const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const INVALID_CHARS = /[\\/:*?"<>|]/;

export function validateFileName(name: string): ApiError | null {
  if (name.trim() === "") {
    return { code: "invalid", message: "Name must not be empty or only whitespace." };
  }

  if (name.length > 255) {
    return { code: "invalid", message: "Name must be 255 characters or fewer." };
  }

  if (INVALID_CHARS.test(name)) {
    return { code: "invalid", message: "Name contains invalid characters." };
  }

  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 32) {
      return { code: "invalid", message: "Name contains control characters." };
    }
  }

  const last = name[name.length - 1];
  if (last === " " || last === ".") {
    return { code: "invalid", message: "Name must not end with a space or a period." };
  }

  const dotIndex = name.indexOf(".");
  const stem = (dotIndex === -1 ? name : name.slice(0, dotIndex)).replace(/\s+$/, "").toUpperCase();
  if (RESERVED_NAMES.has(stem)) {
    return { code: "invalid", message: "Name is reserved by the operating system." };
  }

  return null;
}

export function uniqueName(base: string, existing: readonly string[]): string {
  const lowerExisting = new Set(existing.map((n) => n.toLowerCase()));

  if (!lowerExisting.has(base.toLowerCase())) {
    return base;
  }

  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!lowerExisting.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}
