import { FOLDER_LOG_RECORD_MAX_BYTES, METHOD_REQUIRES, STORAGE_VALUE_MAX_BYTES, type ApiError, type CallMethod, type Use } from "../api/types";

export function checkPermission(uses: readonly Use[], method: CallMethod): ApiError | null {
  const required = METHOD_REQUIRES[method];
  if (required === null) {
    return null;
  }
  if (uses.includes(required)) {
    return null;
  }
  return {
    code: "not-declared",
    message: `method "${method}" requires "${required}" in manifest uses`,
  };
}

export function checkStorageValue(value: unknown): ApiError | null {
  const r = toJson(value, STORAGE_VALUE_MAX_BYTES);
  return "error" in r ? r.error : null;
}

/** folderLog.append の data（ADR 0040）。よければ、Rust へ渡す JSON の文字列を返す */
export function checkFolderLogData(value: unknown): { json: string } | { error: ApiError } {
  return toJson(value, FOLDER_LOG_RECORD_MAX_BYTES);
}

function toJson(value: unknown, maxBytes: number): { json: string } | { error: ApiError } {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json === undefined) {
    return { error: { code: "invalid", message: "value is not JSON-serializable" } };
  }
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > maxBytes) {
    return { error: { code: "too-large", message: `value is ${byteLength} bytes, which exceeds the ${maxBytes} byte limit` } };
  }
  return { json };
}
