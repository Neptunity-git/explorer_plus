import { TAG_NAME_MAX, TAGS_MAX, type ApiError, type EntryRef, type Tag } from "../api/types";

export type TagLink = { ref: EntryRef; tagIds: string[] };
export type TagStore = { tags: Tag[]; links: TagLink[] };
export type StoreResult = { ok: true; store: TagStore } | { ok: false; error: ApiError };
export type TagResult = { ok: true; store: TagStore; tag: Tag } | { ok: false; error: ApiError };

function err(code: ApiError["code"], message: string): ApiError {
  return { code, message };
}

export function emptyTagStore(): TagStore {
  return { tags: [], links: [] };
}

export function normalizeColor(color: unknown): string | null {
  if (typeof color !== "string") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return color.toLowerCase();
}

export function sameRef(a: EntryRef, b: EntryRef): boolean {
  if (a.id !== "" && b.id !== "") return a.id === b.id;
  return a.path.toLowerCase() === b.path.toLowerCase();
}

function nameInvalid(name: string): boolean {
  const t = name.trim();
  return t === "" || t.length > TAG_NAME_MAX;
}

export function createTag(store: TagStore, name: string, color: string, id: string): TagResult {
  const trimmed = name.trim();
  if (nameInvalid(name)) return { ok: false, error: err("invalid", "tag name is empty or too long") };
  const norm = normalizeColor(color);
  if (norm === null) return { ok: false, error: err("invalid", "tag color is not a valid #rrggbb") };
  if (store.tags.some((t) => t.id === id)) return { ok: false, error: err("invalid", "tag id already exists") };
  if (store.tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase()))
    return { ok: false, error: err("exists", "a tag with this name already exists") };
  if (store.tags.length >= TAGS_MAX) return { ok: false, error: err("too-large", "too many tags") };
  const tag: Tag = { id, name: trimmed, color: norm };
  const next: TagStore = { tags: [...store.tags, tag], links: store.links.map((l) => ({ ref: { ...l.ref }, tagIds: [...l.tagIds] })) };
  return { ok: true, store: next, tag };
}

export function updateTag(store: TagStore, id: string, patch: { name?: string; color?: string }): TagResult {
  const idx = store.tags.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: err("not-found", "tag not found") };
  const cur = store.tags[idx];
  let name = cur.name;
  let color = cur.color;
  if (patch.name !== undefined) {
    if (nameInvalid(patch.name)) return { ok: false, error: err("invalid", "tag name is empty or too long") };
    const trimmed = patch.name.trim();
    if (store.tags.some((t) => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase()))
      return { ok: false, error: err("exists", "a tag with this name already exists") };
    name = trimmed;
  }
  if (patch.color !== undefined) {
    const norm = normalizeColor(patch.color);
    if (norm === null) return { ok: false, error: err("invalid", "tag color is not a valid #rrggbb") };
    color = norm;
  }
  const tag: Tag = { id, name, color };
  const tags = store.tags.map((t, i) => (i === idx ? tag : { ...t }));
  const next: TagStore = { tags, links: store.links.map((l) => ({ ref: { ...l.ref }, tagIds: [...l.tagIds] })) };
  return { ok: true, store: next, tag };
}

export function deleteTag(store: TagStore, id: string): StoreResult {
  if (!store.tags.some((t) => t.id === id)) return { ok: false, error: err("not-found", "tag not found") };
  const tags = store.tags.filter((t) => t.id !== id);
  const links = store.links
    .map((l) => ({ ref: { ...l.ref }, tagIds: l.tagIds.filter((tid) => tid !== id) }))
    .filter((l) => l.tagIds.length > 0);
  return { ok: true, store: { tags, links } };
}

export function assignTag(store: TagStore, refs: readonly EntryRef[], tagId: string, on: boolean): StoreResult {
  if (!store.tags.some((t) => t.id === tagId)) return { ok: false, error: err("not-found", "tag not found") };
  let links = store.links.map((l) => ({ ref: { ...l.ref }, tagIds: [...l.tagIds] }));
  for (const ref of refs) {
    const i = links.findIndex((l) => sameRef(l.ref, ref));
    if (on) {
      if (i === -1) {
        links.push({ ref: { ...ref }, tagIds: [tagId] });
      } else {
        const l = links[i];
        if (!l.tagIds.includes(tagId)) l.tagIds.push(tagId);
        l.ref = { ...ref };
      }
    } else {
      if (i !== -1) {
        const l = links[i];
        l.tagIds = l.tagIds.filter((tid) => tid !== tagId);
        if (l.tagIds.length === 0) links = links.filter((_, j) => j !== i);
      }
    }
  }
  return { ok: true, store: { tags: store.tags.map((t) => ({ ...t })), links } };
}

export function tagsOf(store: TagStore, ref: EntryRef): string[] {
  const link = store.links.find((l) => sameRef(l.ref, ref));
  if (!link) return [];
  const set = new Set(link.tagIds);
  return store.tags.map((t) => t.id).filter((id) => set.has(id));
}

export function refsWithTag(store: TagStore, tagId: string): EntryRef[] {
  return store.links.filter((l) => l.tagIds.includes(tagId)).map((l) => ({ ...l.ref }));
}
