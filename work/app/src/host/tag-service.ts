// タグ（ADR 0010）。アプリ全体で1つの保存内容を持ち、変わったら知らせる。
// 保存内容の変え方（重なりの検査など）は src/core/tags.ts に任せ、ここは読み込み・保存・知らせだけを持つ。
import type { ApiError, EntryRef, Tag } from "../api/types";
import { assignTag, createTag, deleteTag, emptyTagStore, refsWithTag, tagsOf, updateTag, type TagStore } from "../core/tags";
import { backend, BackendError, type RawEntry } from "./backend";

const SAVE_DELAY_MS = 300;
const RESOLVE_CHUNK = 100;

function looksLikeStore(v: unknown): v is TagStore {
  return !!v && typeof v === "object" && Array.isArray((v as TagStore).tags) && Array.isArray((v as TagStore).links);
}

function fail(error: ApiError): never {
  throw new BackendError(error);
}

class TagService {
  private store: TagStore = emptyTagStore();
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  /** 起動時に1回。壊れていたら空から始める */
  load(): Promise<void> {
    this.loading ??= backend.appDataLoad("tags").then((text) => {
      try {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (looksLikeStore(parsed)) this.store = parsed;
      } catch {
        // 壊れた保存内容は、次の保存で上書きされる
      }
    });
    return this.loading;
  }

  /** ほかのウィンドウが保存した：読み直す（このウィンドウに、まだ書いていない変更があれば、そちらを書く） */
  async reload() {
    if (this.timer) return;
    this.loading = null;
    await this.load();
    for (const cb of this.listeners) cb();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): Tag[] {
    return this.store.tags;
  }

  tagsOf(ref: EntryRef): string[] {
    return tagsOf(this.store, ref);
  }

  create(name: string, color: string): Tag {
    const r = createTag(this.store, name, color, `tag-${crypto.randomUUID().slice(0, 8)}`);
    if (!r.ok) fail(r.error);
    this.commit(r.store);
    return r.tag;
  }

  update(id: string, patch: { name?: string; color?: string }): Tag {
    const r = updateTag(this.store, id, patch);
    if (!r.ok) fail(r.error);
    this.commit(r.store);
    return r.tag;
  }

  delete(id: string) {
    const r = deleteTag(this.store, id);
    if (!r.ok) fail(r.error);
    this.commit(r.store);
  }

  assign(refs: EntryRef[], tagId: string, on: boolean) {
    const r = assignTag(this.store, refs, tagId, on);
    if (!r.ok) fail(r.error);
    this.commit(r.store);
  }

  /** そのタグが付いた項目の今の姿。名前変更・移動していたら、保存しているパスも新しくする */
  async entries(tagId: string): Promise<RawEntry[]> {
    if (!this.store.tags.some((t) => t.id === tagId)) fail({ code: "not-found", message: tagId });
    const refs = refsWithTag(this.store, tagId);
    const found: RawEntry[] = [];
    let moved = this.store;
    for (let i = 0; i < refs.length; i += RESOLVE_CHUNK) {
      const chunk = refs.slice(i, i + RESOLVE_CHUNK);
      const resolved = await backend.resolve(chunk);
      resolved.forEach((raw, k) => {
        if (!raw) return;
        found.push(raw);
        if (raw.path !== chunk[k].path) {
          // 付いているタグはそのままに、ref のパスだけ新しくする（assignTag の「付ける」は ref を置き換える）
          for (const t of tagsOf(moved, chunk[k])) {
            const r = assignTag(moved, [{ id: raw.id, path: raw.path }], t, true);
            if (r.ok) moved = r.store;
          }
        }
      });
    }
    if (moved !== this.store) this.commit(moved, false);
    return found;
  }

  private commit(store: TagStore, notify = true) {
    this.store = store;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      backend.appDataSave("tags", JSON.stringify(this.store)).catch((e) => console.error("tags save failed", e));
    }, SAVE_DELAY_MS);
    if (notify) for (const cb of this.listeners) cb();
  }
}

export const tagService = new TagService();

/** 新しいタグに順番に付ける色（あとで自由に変えられる） */
export const TAG_PALETTE = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];
