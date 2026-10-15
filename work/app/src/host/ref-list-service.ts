// クイックアクセス（ピン留めしたフォルダ）と、最近使った項目（ADR 0014 判断2・3）。
// どちらもアプリ全体で1つの EntryRef の並び。並びの変え方は src/core/ref-lists.ts に任せる。
import type { EntryRef } from "../api/types";
import { pinRefs, pushRecent, unpinRefs } from "../core/ref-lists";
import { sameRef } from "../core/tags";
import { backend, type RawEntry } from "./backend";

const RECENT_MAX = 30;
const RESOLVE_CHUNK = 100;

class RefListService {
  private list: EntryRef[] = [];
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly name: "quickaccess" | "recent") {}

  load(): Promise<void> {
    this.loading ??= backend.appDataLoad(this.name).then((text) => {
      try {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (Array.isArray(parsed)) this.list = parsed.filter((r) => r && typeof r.path === "string").map((r) => ({ id: String(r.id ?? ""), path: r.path }));
      } catch {
        // 壊れていたら空から始める
      }
    });
    return this.loading;
  }

  /** ほかのウィンドウが保存した：読み直す */
  async reload() {
    this.loading = null;
    await this.load();
    for (const cb of this.listeners) cb();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  refs(): EntryRef[] {
    return this.list;
  }

  /** 今の姿（名前変更・移動していれば今の場所）。見つからなくなったものは除く */
  async entries(): Promise<RawEntry[]> {
    const found: RawEntry[] = [];
    for (let i = 0; i < this.list.length; i += RESOLVE_CHUNK) {
      for (const r of await backend.resolve(this.list.slice(i, i + RESOLVE_CHUNK))) if (r) found.push(r);
    }
    return found;
  }

  pin(refs: EntryRef[]) {
    this.commit(pinRefs(this.list, refs));
  }

  unpin(refs: EntryRef[]) {
    this.commit(unpinRefs(this.list, refs));
  }

  push(ref: EntryRef) {
    this.commit(pushRecent(this.list, ref, RECENT_MAX));
  }

  has(ref: EntryRef): boolean {
    return this.list.some((r) => sameRef(r, ref));
  }

  private commit(list: EntryRef[]) {
    this.list = list;
    backend.appDataSave(this.name, JSON.stringify(list)).catch((e) => console.error(`${this.name} save failed`, e));
    for (const cb of this.listeners) cb();
  }
}

export const quickAccess = new RefListService("quickaccess");
export const recentItems = new RefListService("recent");
