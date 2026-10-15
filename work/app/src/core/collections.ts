// コレクション（仮想ディレクトリ。ADR 0005・0025）：実際の場所と関係なく、ファイル・フォルダを集めて名前を付けたもの。
// アプリ全体で1つ。中身はファイルID とパス（EntryRef）で覚える（名前変更・移動に強い）。ここは保存内容の変え方だけ（純粋な関数）。
import type { ApiError, EntryRef } from "../api/types";
import { sameRef } from "./tags";

export const COLLECTIONS_MAX = 200;
export const COLLECTION_ITEMS_MAX = 10000;
const COLOR_RE = /^#[0-9a-f]{6}$/;

export type StoredCollection = { id: string; name: string; color: string; items: EntryRef[] };
export type CollectionStore = { collections: StoredCollection[] };
export type Result = { ok: true; store: CollectionStore } | { ok: false; error: ApiError };

export const emptyCollectionStore = (): CollectionStore => ({ collections: [] });

const fail = (code: ApiError["code"], message: string): Result => ({ ok: false, error: { code, message } });
const clone = (s: CollectionStore): CollectionStore => ({ collections: s.collections.map((c) => ({ ...c, items: c.items.map((r) => ({ ...r })) })) });

function checkName(store: CollectionStore, name: string, exceptId?: string): ApiError | null {
  const n = name.trim();
  if (n === "" || n.length > 60) return { code: "invalid", message: "name must be 1-60 chars" };
  if (store.collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === n.toLowerCase())) return { code: "exists", message: `collection "${n}" exists` };
  return null;
}

export function createCollection(store: CollectionStore, id: string, name: string, color: string): Result {
  if (store.collections.length >= COLLECTIONS_MAX) return fail("too-large", `at most ${COLLECTIONS_MAX} collections`);
  const bad = checkName(store, name);
  if (bad) return { ok: false, error: bad };
  if (!COLOR_RE.test(color)) return fail("invalid", "color must be #rrggbb");
  const next = clone(store);
  next.collections.push({ id, name: name.trim(), color, items: [] });
  return { ok: true, store: next };
}

export function updateCollection(store: CollectionStore, id: string, patch: { name?: string; color?: string }): Result {
  const idx = store.collections.findIndex((c) => c.id === id);
  if (idx < 0) return fail("not-found", `collection ${id}`);
  if (patch.name !== undefined) {
    const bad = checkName(store, patch.name, id);
    if (bad) return { ok: false, error: bad };
  }
  if (patch.color !== undefined && !COLOR_RE.test(patch.color)) return fail("invalid", "color must be #rrggbb");
  const next = clone(store);
  const c = next.collections[idx];
  if (patch.name !== undefined) c.name = patch.name.trim();
  if (patch.color !== undefined) c.color = patch.color;
  return { ok: true, store: next };
}

export function deleteCollection(store: CollectionStore, id: string): Result {
  if (!store.collections.some((c) => c.id === id)) return fail("not-found", `collection ${id}`);
  return { ok: true, store: { collections: clone(store).collections.filter((c) => c.id !== id) } };
}

/** 入れる（もう入っているものは入れない） */
export function addToCollection(store: CollectionStore, id: string, refs: readonly EntryRef[]): Result {
  const idx = store.collections.findIndex((c) => c.id === id);
  if (idx < 0) return fail("not-found", `collection ${id}`);
  const next = clone(store);
  const c = next.collections[idx];
  for (const r of refs) if (!c.items.some((x) => sameRef(x, r))) c.items.push({ id: r.id, path: r.path });
  if (c.items.length > COLLECTION_ITEMS_MAX) return fail("too-large", `at most ${COLLECTION_ITEMS_MAX} items`);
  return { ok: true, store: next };
}

export function removeFromCollection(store: CollectionStore, id: string, refs: readonly EntryRef[]): Result {
  const idx = store.collections.findIndex((c) => c.id === id);
  if (idx < 0) return fail("not-found", `collection ${id}`);
  const next = clone(store);
  next.collections[idx].items = next.collections[idx].items.filter((x) => !refs.some((r) => sameRef(x, r)));
  return { ok: true, store: next };
}

/** 名前変更・移動で場所が変わった項目の、覚えているパスを今のものにする（ファイルID が同じもの） */
export function refreshPaths(store: CollectionStore, found: ReadonlyMap<string, string>): CollectionStore {
  const next = clone(store);
  for (const c of next.collections) for (const r of c.items) if (r.id && found.has(r.id)) r.path = found.get(r.id)!;
  return next;
}
