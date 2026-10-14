// ビューごとの保存（ADR 0005 判断4）。同じビューを複数のタブで開いても、保存先は1つ。
// 読み込みは最初の1回だけ。書き込みは少し待ってまとめて行う（続けて set されても、ディスクへの書き込みは1回）。
import { backend } from "./backend";

const SAVE_DELAY_MS = 300;

class ViewStorage {
  private data: Record<string, unknown> | null = null;
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly viewId: string) {}

  private async load(): Promise<Record<string, unknown>> {
    if (this.data) return this.data;
    this.loading ??= backend.viewStorageLoad(this.viewId).then((text) => {
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // 壊れていたら空から始める（壊れたファイルは次の保存で上書きされる）
      }
      this.data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    });
    await this.loading;
    return this.data!;
  }

  async get(key: string): Promise<unknown> {
    const d = await this.load();
    return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const d = await this.load();
    // JSON にできる値に限る（checkStorageValue で確かめ済み）。保存したときと同じ形で返すため、JSON を通した値を持つ
    d[key] = JSON.parse(JSON.stringify(value));
    this.scheduleSave();
  }

  async delete(key: string): Promise<void> {
    const d = await this.load();
    delete d[key];
    this.scheduleSave();
  }

  async keys(): Promise<string[]> {
    return Object.keys(await this.load());
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      backend.viewStorageSave(this.viewId, JSON.stringify(this.data)).catch((e) => console.error("view storage save failed", e));
    }, SAVE_DELAY_MS);
  }
}

const stores = new Map<string, ViewStorage>();

export function storageFor(viewId: string): ViewStorage {
  let s = stores.get(viewId);
  if (!s) {
    s = new ViewStorage(viewId);
    stores.set(viewId, s);
  }
  return s;
}
