import { METHOD_REQUIRES, RESOLVE_MAX_REFS, TREE_DEPTH, type ApiError, type ModToHostMessage } from "../api/types";

export type ParseResult =
  | { ok: true; message: ModToHostMessage }
  | { ok: false; id: number | null; error: ApiError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRect(value: unknown): { ok: true; rect: { x: number; y: number; width: number; height: number } } | { ok: false } {
  if (!isPlainObject(value)) return { ok: false };
  const { x, y, width, height } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return { ok: false };
  }
  if (width < 0 || height < 0) return { ok: false };
  return { ok: true, rect: { x, y, width, height } };
}

function parseRef(value: unknown): { ok: true; ref: { id: string; path: string } } | { ok: false } {
  if (!isPlainObject(value)) return { ok: false };
  const { id, path } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(path)) return { ok: false };
  return { ok: true, ref: { id, path } };
}

function parseRefArray(value: unknown, min: number, max: number): { ok: true; refs: { id: string; path: string }[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  if (value.length < min || value.length > max) return { ok: false };
  const refs: { id: string; path: string }[] = [];
  for (const item of value) {
    const parsed = parseRef(item);
    if (!parsed.ok) return { ok: false };
    refs.push(parsed.ref);
  }
  return { ok: true, refs };
}

function parseKeyMessage(data: Record<string, unknown>): ParseResult {
  const { key, ctrl, shift, alt } = data;
  if (!isNonEmptyString(key) || typeof ctrl !== "boolean" || typeof shift !== "boolean" || typeof alt !== "boolean") {
    return { ok: false, id: null, error: { code: "invalid", message: "invalid key message" } };
  }
  return { ok: true, message: { ep: 1, kind: "key", key, ctrl, shift, alt } };
}

function parseCallParams(method: string, params: Record<string, unknown>): { ok: true; params: Record<string, unknown> } | { ok: false } {
  switch (method) {
    case "ready":
    case "navigateUp":
    case "storage.keys":
      return { ok: true, params: {} };

    case "open": {
      const { id, path, from } = params;
      if (!isNonEmptyString(id) || !isNonEmptyString(path)) return { ok: false };
      const result: Record<string, unknown> = { id, path };
      if (from !== undefined) {
        const parsedRect = parseRect(from);
        if (!parsedRect.ok) return { ok: false };
        result.from = parsedRect.rect;
      }
      return { ok: true, params: result };
    }

    case "navigate": {
      const { path } = params;
      if (!isNonEmptyString(path)) return { ok: false };
      return { ok: true, params: { path } };
    }

    case "trash": {
      const { items, from } = params;
      const parsedItems = parseRefArray(items, 1, 100);
      if (!parsedItems.ok) return { ok: false };
      const result: Record<string, unknown> = { items: parsedItems.refs };
      if (from !== undefined) {
        const parsedRect = parseRect(from);
        if (!parsedRect.ok) return { ok: false };
        result.from = parsedRect.rect;
      }
      return { ok: true, params: result };
    }

    case "storage.get":
    case "storage.delete": {
      const { key } = params;
      if (!isNonEmptyString(key) || key.length > 100) return { ok: false };
      return { ok: true, params: { key } };
    }

    case "storage.set": {
      const { key, value } = params;
      if (!isNonEmptyString(key) || key.length > 100) return { ok: false };
      if (!("value" in params)) return { ok: false };
      return { ok: true, params: { key, value } };
    }

    case "getTree": {
      const { depth } = params;
      if (!isInt(depth) || depth < TREE_DEPTH.min || depth > TREE_DEPTH.max) return { ok: false };
      return { ok: true, params: { depth } };
    }

    case "resolve": {
      const { refs } = params;
      const parsedRefs = parseRefArray(refs, 1, RESOLVE_MAX_REFS);
      if (!parsedRefs.ok) return { ok: false };
      return { ok: true, params: { refs: parsedRefs.refs } };
    }

    default:
      return { ok: false };
  }
}

/** Number.isInteger と同じ判定。TypeScript に「数である」と伝えるための形 */
function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function parseModMessage(data: unknown): ParseResult {
  if (!isPlainObject(data)) {
    return { ok: false, id: null, error: { code: "invalid", message: "data must be a plain object" } };
  }
  if (data.ep !== 1) {
    return { ok: false, id: null, error: { code: "invalid", message: "ep must be 1" } };
  }

  const { kind } = data;

  if (kind === "key") {
    return parseKeyMessage(data);
  }

  if (kind === "call") {
    const { id, method, params } = data;
    if (!isInt(id) || id <= 0) {
      return { ok: false, id: null, error: { code: "invalid", message: "id must be a positive integer" } };
    }
    if (typeof method !== "string" || !(method in METHOD_REQUIRES)) {
      return { ok: false, id, error: { code: "invalid", message: "unknown method" } };
    }
    if (!isPlainObject(params)) {
      return { ok: false, id, error: { code: "invalid", message: "params must be a plain object" } };
    }
    const parsed = parseCallParams(method, params);
    if (!parsed.ok) {
      return { ok: false, id, error: { code: "invalid", message: `invalid params for ${method}` } };
    }
    return { ok: true, message: { ep: 1, kind: "call", id, method: method as ModToHostMessage extends { method: infer M } ? M : never, params: parsed.params } };
  }

  return { ok: false, id: null, error: { code: "invalid", message: "unknown kind" } };
}
