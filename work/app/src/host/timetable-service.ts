// 時間割（ADR 0010・0012）。学校のフォルダごとに持つ。
// 検査は src/core/timetable.ts、登録簿の操作と「今の授業」は src/core/timetables.ts に任せる。
import type { CurrentClass, EntryRef, Timetable } from "../api/types";
import { validateTimetable } from "../core/timetable";
import { currentClass } from "../core/timetable-now";
import { allCurrent, emptyRegistry, findTimetable, putTimetable, removeTimetable, type NowClass, type TimetableRegistry } from "../core/timetables";
import { backend, BackendError, type Location } from "./backend";

/** 位置は、この間だけ覚えておく（場所の条件を使う時間割があるときだけ取る） */
const LOCATION_TTL_MS = 5 * 60 * 1000;

function looksLikeRegistry(v: unknown): v is TimetableRegistry {
  return !!v && typeof v === "object" && Array.isArray((v as TimetableRegistry).entries);
}

class TimetableService {
  private reg: TimetableRegistry = emptyRegistry();
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private location: { at: number; value: Location | null } | null = null;

  load(): Promise<void> {
    this.loading ??= backend.appDataLoad("timetables").then((text) => {
      try {
        const parsed: unknown = text ? JSON.parse(text) : null;
        if (!looksLikeRegistry(parsed)) return;
        // 1つずつ検査し、壊れた時間割は捨てる
        let reg = emptyRegistry();
        for (const e of parsed.entries) {
          const r = validateTimetable(e?.timetable);
          if (r.ok && e?.folder && typeof e.folder.path === "string") reg = putTimetable(reg, { id: String(e.folder.id ?? ""), path: e.folder.path }, r.timetable);
        }
        this.reg = reg;
      } catch {
        // 壊れていたら空から始める
      }
    });
    return this.loading;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get(folder: EntryRef): Timetable | null {
    return findTimetable(this.reg, folder);
  }

  /** すべての時間割（学校のフォルダと、その時間割） */
  all(): TimetableRegistry["entries"] {
    return this.reg.entries;
  }

  /** 検査して保存する。結びつけたフォルダのファイルID が空なら、パスから引いて埋める（名前変更・移動に強くするため） */
  async set(folder: EntryRef, raw: unknown): Promise<Timetable> {
    const r = validateTimetable(raw);
    if (!r.ok) throw new BackendError({ code: "invalid", message: r.errors.join("\n") });
    const tt = r.timetable;
    const missing = [...tt.slots.flatMap((s) => s.folders), ...(tt.ondemand ?? []).flatMap((o) => o.folders)].filter((f) => f.id === "");
    if (missing.length > 0) {
      const ids = await backend.fileIds(missing.map((f) => f.path));
      missing.forEach((f, i) => (f.id = ids[i]));
    }
    await this.commit(putTimetable(this.reg, folder, tt));
    return tt;
  }

  async delete(folder: EntryRef): Promise<void> {
    await this.commit(removeTimetable(this.reg, folder));
  }

  private async commit(reg: TimetableRegistry) {
    this.reg = reg;
    await backend.appDataSave("timetables", JSON.stringify(reg));
    for (const cb of this.listeners) cb();
  }

  private async here(): Promise<Location | null> {
    if (!this.reg.entries.some((e) => e.timetable.place)) return null;
    if (this.location && Date.now() - this.location.at < LOCATION_TTL_MS) return this.location.value;
    let value: Location | null = null;
    try {
      value = await backend.getLocation();
    } catch {
      // Wi-Fi の無い PC など、位置が取れないときは時刻だけで決める（ADR 0010 判断4）
    }
    this.location = { at: Date.now(), value };
    return value;
  }

  /** そのフォルダの時間割での、今の授業 */
  async current(folder: EntryRef, now = new Date()): Promise<CurrentClass> {
    const tt = this.get(folder);
    return tt ? currentClass(tt, now, tt.place ? await this.here() : null) : null;
  }

  /** すべての時間割での、今の授業（アドレスバーの横のボタン用） */
  async allNow(now = new Date()): Promise<NowClass[]> {
    return allCurrent(this.reg, now, await this.here());
  }
}

export const timetableService = new TimetableService();
