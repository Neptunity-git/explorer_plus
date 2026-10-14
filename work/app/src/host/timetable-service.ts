// 時間割（ADR 0010）。アプリ全体で1つ。検査は src/core/timetable.ts、「今の授業」の判定は src/core/timetable-now.ts に任せる。
import type { CurrentClass, Timetable } from "../api/types";
import { emptyTimetable, validateTimetable } from "../core/timetable";
import { currentClass } from "../core/timetable-now";
import { backend, BackendError, type Location } from "./backend";

/** 位置は、この間だけ覚えておく（時間割の場所の条件を使うときだけ取る） */
const LOCATION_TTL_MS = 5 * 60 * 1000;

class TimetableService {
  private tt: Timetable = emptyTimetable();
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private location: { at: number; value: Location | null } | null = null;

  load(): Promise<void> {
    this.loading ??= backend.appDataLoad("timetable").then((text) => {
      try {
        const r = validateTimetable(text ? JSON.parse(text) : null);
        if (r.ok) this.tt = r.timetable;
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

  get(): Timetable {
    return this.tt;
  }

  /** 検査して保存する。結びつけたフォルダのファイルID が空なら、パスから引いて埋める（名前変更・移動に強くするため） */
  async set(raw: unknown): Promise<Timetable> {
    const r = validateTimetable(raw);
    if (!r.ok) throw new BackendError({ code: "invalid", message: r.errors.join("\n") });
    const tt = r.timetable;
    const missing = tt.slots.flatMap((s) => s.folders.filter((f) => f.id === ""));
    if (missing.length > 0) {
      const ids = await backend.fileIds(missing.map((f) => f.path));
      missing.forEach((f, i) => (f.id = ids[i]));
    }
    this.tt = tt;
    await backend.appDataSave("timetable", JSON.stringify(tt));
    for (const cb of this.listeners) cb();
    return tt;
  }

  private async here(): Promise<Location | null> {
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

  async current(now = new Date()): Promise<CurrentClass> {
    const here = this.tt.place ? await this.here() : null;
    return currentClass(this.tt, now, here);
  }
}

export const timetableService = new TimetableService();
