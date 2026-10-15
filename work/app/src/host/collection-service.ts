// コレクション（仮想ディレクトリ。ADR 0025）と、MOD に与えた許可。どちらもアプリ全体で1つで、アプリのデータに置く。
// コレクションの変え方は src/core/collections.ts に任せ、ここは読み込み・保存・知らせ・今の場所の引き直しだけ。
import type { ApiError, Collection, EntryRef } from "../api/types";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  emptyCollectionStore,
  refreshPaths,
  removeFromCollection,
  updateCollection,
  type CollectionStore,
  type Result,
} from "../core/collections";
import { backend, BackendError, type RawEntry } from "./backend";
import { TAG_PALETTE } from "./tag-service";

const RESOLVE_CHUNK = 100;

function looksLikeStore(v: unknown): v is CollectionStore {
  return !!v && typeof v === "object" && Array.isArray((v as CollectionStore).collections);
}

function take(r: Result): CollectionStore {
  if (!r.ok) throw new BackendError(r.error as ApiError);
  return r.store;
}

class CollectionService {
  private store: CollectionStore = emptyCollectionStore();
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  load(): Promise<void> {
    this.loading ??= backend
      .appDataLoad("collections")
      .then((text) => {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (looksLikeStore(parsed)) this.store = parsed;
      })
      .catch(() => {});
    return this.loading;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): Collection[] {
    return this.store.collections.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.items.length }));
  }

  private async commit(store: CollectionStore, notify = true) {
    this.store = store;
    await backend.appDataSave("collections", JSON.stringify(store));
    if (notify) for (const cb of this.listeners) cb();
  }

  async create(name: string, color?: string): Promise<Collection> {
    await this.load();
    const id = `col-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.commit(take(createCollection(this.store, id, name, color ?? TAG_PALETTE[this.store.collections.length % TAG_PALETTE.length])));
    return this.list().find((c) => c.id === id)!;
  }

  async update(id: string, patch: { name?: string; color?: string }): Promise<Collection> {
    await this.load();
    await this.commit(take(updateCollection(this.store, id, patch)));
    return this.list().find((c) => c.id === id)!;
  }

  name(id: string): string | null {
    return this.store.collections.find((c) => c.id === id)?.name ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.load();
    await this.commit(take(deleteCollection(this.store, id)));
  }

  async add(id: string, refs: EntryRef[]): Promise<void> {
    await this.load();
    await this.commit(take(addToCollection(this.store, id, refs)));
  }

  async remove(id: string, refs: EntryRef[]): Promise<void> {
    await this.load();
    await this.commit(take(removeFromCollection(this.store, id, refs)));
  }

  /** 中身の今の姿。見つからなくなったもの（消した・別のドライブへ動かした）は missing に入れる */
  async entries(id: string): Promise<{ found: RawEntry[]; missing: EntryRef[] }> {
    await this.load();
    const c = this.store.collections.find((x) => x.id === id);
    if (!c) throw new BackendError({ code: "not-found", message: `collection ${id}` });
    const found: RawEntry[] = [];
    const missing: EntryRef[] = [];
    const moved = new Map<string, string>();
    for (let i = 0; i < c.items.length; i += RESOLVE_CHUNK) {
      const part = c.items.slice(i, i + RESOLVE_CHUNK);
      const now = await backend.resolve(part);
      now.forEach((r, j) => {
        if (!r) missing.push(part[j]);
        else {
          found.push(r);
          if (r.id && r.path !== part[j].path) moved.set(r.id, r.path);
        }
      });
    }
    // 名前変更・移動したものは、覚えているパスを今のものにしておく（知らせは出さない）
    if (moved.size > 0) await this.commit(refreshPaths(this.store, moved), false);
    return { found, missing };
  }
}

export const collectionService = new CollectionService();

// ---- MOD に与えた許可（ファイルを作る、など。ADR 0025） ----

class GrantService {
  private data: Record<string, string[]> = {};
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= backend
      .appDataLoad("grants")
      .then((text) => {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.data = parsed as Record<string, string[]>;
      })
      .catch(() => {});
    return this.loading;
  }

  async has(viewId: string, what: string): Promise<boolean> {
    await this.load();
    return (this.data[viewId] ?? []).includes(what);
  }

  async grant(viewId: string, what: string): Promise<void> {
    await this.load();
    this.data[viewId] = [...new Set([...(this.data[viewId] ?? []), what])];
    await backend.appDataSave("grants", JSON.stringify(this.data));
  }

  /** MOD を外したら、与えた許可も取り消す（入れ直したら、また聞く） */
  async revokeAll(viewId: string): Promise<void> {
    await this.load();
    if (!(viewId in this.data)) return;
    delete this.data[viewId];
    await backend.appDataSave("grants", JSON.stringify(this.data));
  }
}

export const grantService = new GrantService();
