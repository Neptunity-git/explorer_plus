import { METHOD_REQUIRES, STORAGE_VALUE_MAX_BYTES, type ApiError, type CallMethod, type Use } from "../api/types";

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
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return {
      code: "invalid",
      message: "value is not JSON-serializable",
    };
  }
  if (json === undefined) {
    return {
      code: "invalid",
      message: "value is not JSON-serializable",
    };
  }
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > STORAGE_VALUE_MAX_BYTES) {
    return {
      code: "too-large",
      message: `value is ${byteLength} bytes, which exceeds the ${STORAGE_VALUE_MAX_BYTES} byte limit`,
    };
  }
  return null;
}
