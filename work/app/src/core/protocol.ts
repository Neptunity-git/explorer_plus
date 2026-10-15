import { DROP_TARGETS_MAX, METHOD_REQUIRES, NET_METHODS, MENU_LABEL_MAX, MENU_MAX_EXTRA, MENU_MAX_ITEMS, QUICK_ACCESS_MAX_ITEMS, RESOLVE_MAX_REFS, TAG_ASSIGN_MAX_ITEMS, TAG_NAME_MAX, TRANSFER_MAX_ITEMS, TREE_DEPTH, type ApiError, type ModToHostMessage } from "../api/types";

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

    // ↓ 読み取りの API（ADR 0023）
    case "files.readText":
    case "files.readBytes": {
      const item = parseRef(params.item);
      const offset = optInt(params.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const size =
        method === "files.readText" ? optInt(params.maxBytes, 1, 8 * 1024 * 1024, 1024 * 1024) : optInt(params.length, 1, 16 * 1024 * 1024, 1024 * 1024);
      if (!item.ok || !offset.ok || !size.ok) return { ok: false };
      return {
        ok: true,
        params: method === "files.readText" ? { item: item.ref, offset: offset.value, maxBytes: size.value } : { item: item.ref, offset: offset.value, length: size.value },
      };
    }

    case "files.url": {
      const item = parseRef(params.item);
      if (!item.ok) return { ok: false };
      return { ok: true, params: { item: item.ref } };
    }

    case "files.info":
    case "files.properties": {
      const items = parseRefArray(params.items, 1, 500);
      if (!items.ok) return { ok: false };
      if (method === "files.info") return { ok: true, params: { items: items.refs } };
      const names = params.names;
      if (!Array.isArray(names) || names.length < 1 || names.length > 60 || !names.every((n) => isString(n) && /^System\.[A-Za-z0-9.]{1,73}$/.test(n))) return { ok: false };
      return { ok: true, params: { items: items.refs, names } };
    }

    case "search.find":
    case "search.stats": {
      const folder = parseRef(params.folder);
      const depth = optInt(params.depth, 1, 64, undefined);
      if (!folder.ok || !depth.ok) return { ok: false };
      if (method === "search.stats") return { ok: true, params: { folder: folder.ref, depth: depth.value } };
      const query = parseSearchQuery(params.query);
      const limit = optInt(params.limit, 1, 5000, undefined);
      if (!query.ok || !limit.ok) return { ok: false };
      return { ok: true, params: { folder: folder.ref, query: query.query, depth: depth.value, limit: limit.value } };
    }

    case "system.drives":
    case "system.info":
      return { ok: true, params: {} };

    // ↓ 本体の画面を使う API（ADR 0024）
    case "ui.toast": {
      const { text } = params;
      if (!isNonEmptyString(text) || text.length > 200) return { ok: false };
      return { ok: true, params: { text } };
    }

    case "ui.status": {
      const { text } = params;
      if (text !== null && !(isString(text) && text.length <= 120)) return { ok: false };
      return { ok: true, params: { text } };
    }

    case "ui.tab": {
      const out: Record<string, unknown> = {};
      for (const [k, max] of [["title", 40], ["badge", 8]] as const) {
        const v = params[k];
        if (v === undefined) continue;
        if (v !== null && !(isNonEmptyString(v) && v.length <= max)) return { ok: false };
        out[k] = v;
      }
      return { ok: true, params: out };
    }

    case "ui.confirm": {
      const { message, okLabel } = params;
      if (!isNonEmptyString(message) || message.length > 500) return { ok: false };
      if (okLabel !== undefined && !(isNonEmptyString(okLabel) && okLabel.length <= 20)) return { ok: false };
      return { ok: true, params: { message, ...(okLabel !== undefined ? { okLabel } : {}) } };
    }

    case "ui.ask": {
      const { label, value, placeholder, okLabel } = params;
      if (!isNonEmptyString(label) || label.length > 60) return { ok: false };
      if (value !== undefined && !(isString(value) && value.length <= 500)) return { ok: false };
      if (placeholder !== undefined && !(isString(placeholder) && placeholder.length <= 100)) return { ok: false };
      if (okLabel !== undefined && !(isNonEmptyString(okLabel) && okLabel.length <= 20)) return { ok: false };
      return { ok: true, params: { label, ...(value !== undefined ? { value } : {}), ...(placeholder !== undefined ? { placeholder } : {}), ...(okLabel !== undefined ? { okLabel } : {}) } };
    }

    case "ui.choose":
    case "commands.set": {
      const list = method === "ui.choose" ? params.items : params.commands;
      const max = method === "ui.choose" ? 200 : 50;
      if (!Array.isArray(list) || list.length > max || (method === "ui.choose" && list.length === 0)) return { ok: false };
      const items: { id: string; label: string; hint?: string }[] = [];
      for (const it of list) {
        if (!isPlainObject(it) || !isNonEmptyString(it.id) || it.id.length > 64 || !isNonEmptyString(it.label) || it.label.length > 60) return { ok: false };
        if (it.hint !== undefined && !(isString(it.hint) && it.hint.length <= 60)) return { ok: false };
        items.push({ id: it.id, label: it.label, ...(it.hint !== undefined ? { hint: it.hint as string } : {}) });
      }
      if (method === "commands.set") return { ok: true, params: { commands: items } };
      const { title } = params;
      if (title !== undefined && !(isString(title) && title.length <= 60)) return { ok: false };
      return { ok: true, params: { items, ...(title !== undefined ? { title } : {}) } };
    }

    case "settings.get":
      return { ok: true, params: {} };

    // ↓ 書き込みとコレクション（ADR 0025）
    case "files.create": {
      const folder = parseRef(params.folder);
      const { name, text, bytes } = params;
      const kind = params.kind ?? "file";
      if (!folder.ok || !isNonEmptyString(name) || name.length > 200 || (kind !== "file" && kind !== "folder")) return { ok: false };
      if (text !== undefined && bytes !== undefined) return { ok: false };
      if (text !== undefined && !(isString(text) && text.length <= 16 * 1024 * 1024)) return { ok: false };
      // 別の iframe から届いた Uint8Array は instanceof では見分けられないので、ArrayBuffer.isView で見る
      if (bytes !== undefined && !(ArrayBuffer.isView(bytes) && bytes.byteLength <= 16 * 1024 * 1024)) return { ok: false };
      if (kind === "folder" && (text !== undefined || bytes !== undefined)) return { ok: false };
      return { ok: true, params: { folder: folder.ref, name, kind, ...(text !== undefined ? { text } : {}), ...(bytes !== undefined ? { bytes } : {}) } };
    }

    case "files.createShortcut": {
      const folder = parseRef(params.folder);
      const target = parseRef(params.target);
      const { name } = params;
      if (!folder.ok || !target.ok) return { ok: false };
      if (name !== undefined && !(isNonEmptyString(name) && name.length <= 150)) return { ok: false };
      return { ok: true, params: { folder: folder.ref, target: target.ref, ...(name !== undefined ? { name } : {}) } };
    }

    case "collections.list":
      return { ok: true, params: {} };

    case "collections.create":
    case "collections.update": {
      const { id, name, color } = params;
      if (method === "collections.update" && !isNonEmptyString(id)) return { ok: false };
      if (method === "collections.create" && !isString(name)) return { ok: false };
      if (name !== undefined && !(isString(name) && name.length <= 100)) return { ok: false };
      if (color !== undefined && !(isString(color) && /^#[0-9a-f]{6}$/.test(color))) return { ok: false };
      return { ok: true, params: { ...(id !== undefined ? { id } : {}), ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) } };
    }

    case "collections.delete":
    case "collections.entries": {
      const { id } = params;
      if (!isNonEmptyString(id) || id.length > 64) return { ok: false };
      return { ok: true, params: { id } };
    }

    case "collections.add":
    case "collections.remove": {
      const { id } = params;
      const items = parseRefArray(params.items, 1, 1000);
      if (!isNonEmptyString(id) || id.length > 64 || !items.ok) return { ok: false };
      return { ok: true, params: { id, items: items.refs } };
    }

    // ↓ 本体が代わりに通信する（ADR 0027）。宛先が network にあるかは Rust が確かめる
    case "net.fetch": {
      const { url, secret, body } = params;
      const method = params.method === undefined ? "GET" : typeof params.method === "string" ? params.method.toUpperCase() : null;
      if (!isNonEmptyString(url) || url.length > 4096 || !(NET_METHODS as readonly (string | null)[]).includes(method)) return { ok: false };
      if (secret !== undefined && !(isString(secret) && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(secret))) return { ok: false };
      const raw = params.headers ?? [];
      if (!Array.isArray(raw) || raw.length > 30) return { ok: false };
      const headers: [string, string][] = [];
      for (const h of raw) {
        if (!Array.isArray(h) || h.length !== 2 || !isNonEmptyString(h[0]) || !isString(h[1]) || h[0].length > 64 || h[1].length > 8192) return { ok: false };
        headers.push([h[0], h[1]]);
      }
      if (body !== undefined && !(isString(body) && body.length <= 4 * 1024 * 1024) && !(ArrayBuffer.isView(body) && body.byteLength <= 4 * 1024 * 1024)) return { ok: false };
      if (body !== undefined && (method === "GET" || method === "HEAD")) return { ok: false };
      return { ok: true, params: { url, method, headers, ...(body !== undefined ? { body } : {}), ...(secret !== undefined ? { secret } : {}) } };
    }

    case "net.url": {
      const { url, secret } = params;
      if (!isNonEmptyString(url) || url.length > 4096) return { ok: false };
      if (secret !== undefined && !(isString(secret) && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(secret))) return { ok: false };
      return { ok: true, params: { url, ...(secret !== undefined ? { secret } : {}) } };
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

/** search.find の条件（ADR 0023）。知らない項目は捨てる */
function parseSearchQuery(value: unknown): { ok: true; query: Record<string, unknown> } | { ok: false } {
  if (value === undefined) return { ok: true, query: {} };
  if (!isPlainObject(value)) return { ok: false };
  const q: Record<string, unknown> = {};
  const text = (k: string) => {
    const v = value[k];
    if (v === undefined) return true;
    if (!isString(v) || v.length > 200) return false;
    q[k] = v;
    return true;
  };
  const count = (k: string) => {
    const v = value[k];
    if (v === undefined) return true;
    if (!isFiniteNumber(v) || v < 0) return false;
    q[k] = v;
    return true;
  };
  if (!text("name") || !text("content")) return { ok: false };
  if (!count("minSize") || !count("maxSize") || !count("modifiedAfter") || !count("modifiedBefore")) return { ok: false };
  if (value.kind !== undefined) {
    if (value.kind !== "file" && value.kind !== "folder") return { ok: false };
    q.kind = value.kind;
  }
  if (value.hidden !== undefined) {
    if (typeof value.hidden !== "boolean") return { ok: false };
    q.hidden = value.hidden;
  }
  if (value.ext !== undefined) {
    if (!Array.isArray(value.ext) || value.ext.length > 50 || !value.ext.every((e) => isString(e) && e.length <= 20)) return { ok: false };
    q.ext = value.ext;
  }
  return { ok: true, query: q };
}

/** 省略できる整数（min〜max）。省略なら dflt */
function optInt(v: unknown, min: number, max: number, dflt: number | undefined): { ok: true; value: number | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: dflt };
  if (!isInt(v) || v < min || v > max) return { ok: false };
  return { ok: true, value: v };
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
