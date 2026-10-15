import { DROP_TARGETS_MAX, METHOD_REQUIRES, MENU_LABEL_MAX, MENU_MAX_EXTRA, MENU_MAX_ITEMS, QUICK_ACCESS_MAX_ITEMS, RESOLVE_MAX_REFS, TAG_ASSIGN_MAX_ITEMS, TAG_NAME_MAX, TRANSFER_MAX_ITEMS, TREE_DEPTH, type ApiError, type ModToHostMessage } from "../api/types";

export type ParseResult =
  | { ok: true; message: ModToHostMessage }
  | { ok: false; id: number | null; error: ApiError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
  if (!isString(id) || !isNonEmptyString(path)) return { ok: false };
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

function parseDropTarget(value: unknown): { ok: true; target: { id: string; path: string; x: number; y: number; width: number; height: number } } | { ok: false } {
  if (!isPlainObject(value)) return { ok: false };
  const { id, path, x, y, width, height } = value;
  if (!isString(id)) return { ok: false };
  if (!isNonEmptyString(path)) return { ok: false };
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return { ok: false };
  if (width < 0 || height < 0) return { ok: false };
  return { ok: true, target: { id, path, x, y, width, height } };
}

function parseDropTargets(value: unknown): { ok: true; targets: { id: string; path: string; x: number; y: number; width: number; height: number }[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  if (value.length < 0 || value.length > DROP_TARGETS_MAX) return { ok: false };
  const targets: { id: string; path: string; x: number; y: number; width: number; height: number }[] = [];
  for (const item of value) {
    const parsed = parseDropTarget(item);
    if (!parsed.ok) return { ok: false };
    targets.push(parsed.target);
  }
  return { ok: true, targets };
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
      const { id, path, from, newTab } = params;
      if (!isString(id) || !isNonEmptyString(path)) return { ok: false };
      const result: Record<string, unknown> = { id, path };
      if (from !== undefined) {
        const parsedRect = parseRect(from);
        if (!parsedRect.ok) return { ok: false };
        result.from = parsedRect.rect;
      }
      if (newTab !== undefined) {
        if (typeof newTab !== "boolean") return { ok: false };
        result.newTab = newTab;
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

    case "rename": {
      const { id, path, newName } = params;
      if (!isString(id) || !isNonEmptyString(path)) return { ok: false };
      if (!isString(newName) || newName.length < 1 || newName.length > 255) return { ok: false };
      return { ok: true, params: { id, path, newName } };
    }

    case "createFolder": {
      const { name } = params;
      if (name === undefined) return { ok: true, params: {} };
      if (!isString(name) || name.length < 1 || name.length > 255) return { ok: false };
      return { ok: true, params: { name } };
    }

    case "showMenu": {
      const { x, y, items, extra } = params;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false };
      const parsedItems = parseRefArray(items, 0, MENU_MAX_ITEMS);
      if (!parsedItems.ok) return { ok: false };
      const result: Record<string, unknown> = { x, y, items: parsedItems.refs };
      if (extra !== undefined) {
        if (!Array.isArray(extra) || extra.length < 0 || extra.length > MENU_MAX_EXTRA) return { ok: false };
        const parsedExtra: { id: string; label: string }[] = [];
        for (const item of extra) {
          if (!isPlainObject(item)) return { ok: false };
          const { id, label } = item;
          if (!isString(id) || id.length < 1 || id.length > 64) return { ok: false };
          if (!isString(label) || label.length < 1 || label.length > MENU_LABEL_MAX) return { ok: false };
          parsedExtra.push({ id, label });
        }
        result.extra = parsedExtra;
      }
      return { ok: true, params: result };
    }

    case "tags.list":
    case "timetable.get":
    case "timetable.current":
      return { ok: true, params: {} };

    case "tags.create": {
      const { name, color } = params;
      if (!isString(name) || name.length < 1 || name.length > TAG_NAME_MAX) return { ok: false };
      if (!isString(color) || color.length < 1 || color.length > 16) return { ok: false };
      return { ok: true, params: { name, color } };
    }

    case "tags.update": {
      const { id, name, color } = params;
      if (!isNonEmptyString(id) || id.length > 64) return { ok: false };
      if (name !== undefined && (!isString(name) || name.length < 1 || name.length > TAG_NAME_MAX)) return { ok: false };
      if (color !== undefined && (!isString(color) || color.length < 1 || color.length > 16)) return { ok: false };
      if (name === undefined && color === undefined) return { ok: false };
      const result: Record<string, unknown> = { id };
      if (name !== undefined) result.name = name;
      if (color !== undefined) result.color = color;
      return { ok: true, params: result };
    }

    case "tags.delete": {
      const { id } = params;
      if (!isNonEmptyString(id) || id.length > 64) return { ok: false };
      return { ok: true, params: { id } };
    }

    case "tags.assign": {
      const { items, tagId, on } = params;
      const parsedItems = parseRefArray(items, 1, TAG_ASSIGN_MAX_ITEMS);
      if (!parsedItems.ok) return { ok: false };
      if (!isNonEmptyString(tagId) || tagId.length > 64) return { ok: false };
      if (typeof on !== "boolean") return { ok: false };
      return { ok: true, params: { items: parsedItems.refs, tagId, on } };
    }

    case "tags.entries": {
      const { tagId } = params;
      if (!isNonEmptyString(tagId) || tagId.length > 64) return { ok: false };
      return { ok: true, params: { tagId } };
    }

    case "timetable.set": {
      if (!("timetable" in params)) return { ok: false };
      return { ok: true, params: { timetable: params.timetable } };
    }

    case "timetable.delete":
    case "views.list":
    case "quickAccess.list":
    case "recent.list":
      return { ok: true, params: {} };

    case "tabs.open": {
      const { viewId, path, replace } = params;
      if (!isNonEmptyString(viewId) || viewId.length > 64) return { ok: false };
      const result: Record<string, unknown> = { viewId };
      if (path !== undefined) {
        if (!isNonEmptyString(path)) return { ok: false };
        result.path = path;
      }
      if (replace !== undefined) {
        if (typeof replace !== "boolean") return { ok: false };
        result.replace = replace;
      }
      return { ok: true, params: result };
    }

    case "quickAccess.pin":
    case "quickAccess.unpin": {
      const { items } = params;
      const parsedItems = parseRefArray(items, 1, QUICK_ACCESS_MAX_ITEMS);
      if (!parsedItems.ok) return { ok: false };
      return { ok: true, params: { items: parsedItems.refs } };
    }

    case "clipboard.copy":
    case "clipboard.cut": {
      const { items } = params;
      const parsedItems = parseRefArray(items, 1, TRANSFER_MAX_ITEMS);
      if (!parsedItems.ok) return { ok: false };
      return { ok: true, params: { items: parsedItems.refs } };
    }

    case "clipboard.paste":
      return { ok: true, params: {} };

    case "drag.start": {
      const { items, x, y, targets } = params;
      const parsedItems = parseRefArray(items, 1, TRANSFER_MAX_ITEMS);
      if (!parsedItems.ok) return { ok: false };
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false };
      const parsedTargets = parseDropTargets(targets);
      if (!parsedTargets.ok) return { ok: false };
      return { ok: true, params: { items: parsedItems.refs, x, y, targets: parsedTargets.targets } };
    }

    case "drag.targets": {
      const { targets } = params;
      const parsedTargets = parseDropTargets(targets);
      if (!parsedTargets.ok) return { ok: false };
      return { ok: true, params: { targets: parsedTargets.targets } };
    }

    case "drag.move": {
      const { x, y, ctrl, shift } = params;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false };
      if (typeof ctrl !== "boolean" || typeof shift !== "boolean") return { ok: false };
      return { ok: true, params: { x, y, ctrl, shift } };
    }

    case "drag.end": {
      const { x, y, ctrl, shift, cancel } = params;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false };
      if (typeof ctrl !== "boolean" || typeof shift !== "boolean" || typeof cancel !== "boolean") return { ok: false };
      return { ok: true, params: { x, y, ctrl, shift, cancel } };
    }

    case "folderData.get":
    case "folderData.delete": {
      const folder = parseRef(params.folder);
      if (!folder.ok) return { ok: false };
      return { ok: true, params: { folder: folder.ref } };
    }

    case "folderData.set": {
      // 値の中身（JSON にできるか・大きさ）は本体が checkStorageValue で確かめる
      const folder = parseRef(params.folder);
      if (!folder.ok || !("value" in params)) return { ok: false };
      return { ok: true, params: { folder: folder.ref, value: params.value } };
    }

    case "mods.list":
    case "mods.install":
    case "mods.addDev":
    case "mods.openDocs":
    case "mods.openDevtools":
      return { ok: true, params: {} };

    case "mods.remove":
    case "mods.pack":
    case "mods.openFolder": {
      const { id } = params;
      if (!isNonEmptyString(id) || id.length > 64) return { ok: false };
      return { ok: true, params: { id } };
    }

    case "mods.createDev": {
      const { name } = params;
      if (!isNonEmptyString(name) || name.length > 40) return { ok: false };
      return { ok: true, params: { name } };
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
