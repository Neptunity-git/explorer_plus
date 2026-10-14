import type { EntryRef, Timetable, TimetableOndemand, TimetablePeriod, TimetablePlace, TimetableSlot } from "../api/types";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function parseTime(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = TIME_RE.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function emptyTimetable(): Timetable {
  return { days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null };
}

export type TimetableResult = { ok: true; timetable: Timetable } | { ok: false; errors: string[] };

export function validateTimetable(raw: unknown): TimetableResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["timetable: must be an object"] };
  }

  const errors: string[] = [];

  // ---- days ----
  let days: number[] = [];
  const rawDays = raw.days;
  if (!Array.isArray(rawDays)) {
    errors.push("days: must be an array");
  } else {
    const seen = new Set<number>();
    for (let i = 0; i < rawDays.length; i++) {
      const d = rawDays[i];
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
        errors.push(`days[${i}]: must be an integer 0-6`);
      } else {
        seen.add(d);
      }
    }
    days = Array.from(seen).sort((a, b) => a - b);
  }

  // ---- periods ----
  const rawPeriods = raw.periods;
  const periods: TimetablePeriod[] = [];
  const periodIds = new Set<string>();
  const validPeriodIds = new Set<string>();

  if (!Array.isArray(rawPeriods)) {
    errors.push("periods: must be an array");
  } else if (rawPeriods.length > 20) {
    errors.push("periods: must have at most 20 elements");
  } else {
    for (let i = 0; i < rawPeriods.length; i++) {
      const p = rawPeriods[i];
      if (!isPlainObject(p)) {
        errors.push(`periods[${i}]: must be an object`);
        continue;
      }

      const id = p.id;
      if (typeof id !== "string" || id.length < 1 || id.length > 32) {
        errors.push(`periods[${i}].id: must be a string of length 1-32`);
      } else if (periodIds.has(id)) {
        errors.push(`periods[${i}].id: must be unique`);
      } else {
        periodIds.add(id);
        validPeriodIds.add(id);
      }

      const label = p.label;
      if (typeof label !== "string" || label.length < 1 || label.length > 20) {
        errors.push(`periods[${i}].label: must be a string of length 1-20`);
      }

      const start = p.start;
      const end = p.end;
      const startMin = parseTime(start);
      const endMin = parseTime(end);

      if (startMin === null) {
        errors.push(`periods[${i}].start: must be HH:MM`);
      }
      if (endMin === null) {
        errors.push(`periods[${i}].end: must be HH:MM`);
      }

      if (startMin !== null && endMin !== null && startMin >= endMin) {
        errors.push(`periods[${i}]: start must be before end`);
      }

      periods.push({
        id: typeof id === "string" ? id : "",
        label: typeof label === "string" ? label : "",
        start: typeof start === "string" ? start : "",
        end: typeof end === "string" ? end : "",
      });
    }
  }

  // ---- slots ----
  const rawSlots = raw.slots;
  const slots: TimetableSlot[] = [];
  const seenSlotKeys = new Set<string>();

  if (!Array.isArray(rawSlots)) {
    errors.push("slots: must be an array");
  } else if (rawSlots.length > 140) {
    errors.push("slots: must have at most 140 elements");
  } else {
    for (let i = 0; i < rawSlots.length; i++) {
      const s = rawSlots[i];
      if (!isPlainObject(s)) {
        errors.push(`slots[${i}]: must be an object`);
        continue;
      }

      const day = s.day;
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        errors.push(`slots[${i}].day: must be an integer 0-6`);
      }

      const periodId = s.periodId;
      if (typeof periodId !== "string" || !validPeriodIds.has(periodId)) {
        errors.push(`slots[${i}].periodId: must reference a valid period id`);
      }

      const title = s.title;
      if (typeof title !== "string" || title.length > 60) {
        errors.push(`slots[${i}].title: must be a string of length 0-60`);
      }

      const rawFolders = s.folders;
      const folders: EntryRef[] = [];
      if (!Array.isArray(rawFolders) || rawFolders.length > 5) {
        errors.push(`slots[${i}].folders: must be an array of length 0-5`);
      } else {
        for (let j = 0; j < rawFolders.length; j++) {
          const f = rawFolders[j];
          if (!isPlainObject(f)) {
            errors.push(`slots[${i}].folders: element ${j} must be an object`);
            continue;
          }
          const fid = f.id;
          const fpath = f.path;
          if (typeof fid !== "string") {
            errors.push(`slots[${i}].folders: element ${j} id must be a string`);
          }
          if (typeof fpath !== "string" || fpath.length === 0) {
            errors.push(`slots[${i}].folders: element ${j} path must be a non-empty string`);
          }
          folders.push({
            id: typeof fid === "string" ? fid : "",
            path: typeof fpath === "string" ? fpath : "",
          });
        }
      }

      const key = `${day}:${periodId}`;
      if (seenSlotKeys.has(key)) {
        errors.push(`slots[${i}]: duplicate day/period combination`);
      } else {
        seenSlotKeys.add(key);
      }

      const memo = s.memo;
      let memoOut: string | undefined;
      if (memo !== undefined) {
        if (typeof memo !== "string" || memo.length > 200) {
          errors.push(`slots[${i}].memo: must be a string of length 0-200`);
        } else {
          memoOut = memo;
        }
      }

      const slotOut: TimetableSlot = {
        day: typeof day === "number" ? day : 0,
        periodId: typeof periodId === "string" ? periodId : "",
        title: typeof title === "string" ? title : "",
        folders,
      };
      if (memoOut !== undefined) {
        slotOut.memo = memoOut;
      }
      slots.push(slotOut);
    }
  }

  // ---- place ----
  let place: TimetablePlace | null = null;
  const rawPlace = raw.place;
  if (rawPlace === undefined || rawPlace === null) {
    place = null;
  } else if (!isPlainObject(rawPlace)) {
    errors.push("place: must be an object or null");
  } else {
    const lat = rawPlace.latitude;
    const lon = rawPlace.longitude;
    const radius = rawPlace.radius;

    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push("place: latitude must be a finite number between -90 and 90");
    }
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      errors.push("place: longitude must be a finite number between -180 and 180");
    }
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0 || radius > 100000) {
      errors.push("place: radius must be a finite number greater than 0 and at most 100000");
    }

    place = {
      latitude: typeof lat === "number" ? lat : 0,
      longitude: typeof lon === "number" ? lon : 0,
      radius: typeof radius === "number" ? radius : 0,
    };
  }

  // ---- ondemand ----
  let ondemand: TimetableOndemand[] | undefined;
  const rawOndemand = raw.ondemand;
  if (rawOndemand !== undefined) {
    if (!Array.isArray(rawOndemand)) {
      errors.push("ondemand: must be an array");
    } else if (rawOndemand.length > 50) {
      errors.push("ondemand: must have at most 50 elements");
    } else {
      const ondemandOut: TimetableOndemand[] = [];
      const seenOndemandIds = new Set<string>();
      for (let i = 0; i < rawOndemand.length; i++) {
        const o = rawOndemand[i];
        if (!isPlainObject(o)) {
          errors.push(`ondemand[${i}]: must be an object`);
          continue;
        }

        const id = o.id;
        if (typeof id !== "string" || id.length < 1 || id.length > 32) {
          errors.push(`ondemand[${i}].id: must be a string of length 1-32`);
        } else if (seenOndemandIds.has(id)) {
          errors.push(`ondemand[${i}].id: must be unique`);
        } else {
          seenOndemandIds.add(id);
        }

        const title = o.title;
        if (typeof title !== "string" || title.length < 1 || title.length > 60) {
          errors.push(`ondemand[${i}].title: must be a string of length 1-60`);
        }

        const rawFolders = o.folders;
        const folders: EntryRef[] = [];
        if (!Array.isArray(rawFolders) || rawFolders.length > 5) {
          errors.push(`ondemand[${i}].folders: must be an array of length 0-5`);
        } else {
          for (let j = 0; j < rawFolders.length; j++) {
            const f = rawFolders[j];
            if (!isPlainObject(f)) {
              errors.push(`ondemand[${i}].folders: element ${j} must be an object`);
              continue;
            }
            const fid = f.id;
            const fpath = f.path;
            if (typeof fid !== "string") {
              errors.push(`ondemand[${i}].folders: element ${j} id must be a string`);
            }
            if (typeof fpath !== "string" || fpath.length === 0) {
              errors.push(`ondemand[${i}].folders: element ${j} path must be a non-empty string`);
            }
            folders.push({
              id: typeof fid === "string" ? fid : "",
              path: typeof fpath === "string" ? fpath : "",
            });
          }
        }

        const memo = o.memo;
        let memoOut: string | undefined;
        if (memo !== undefined) {
          if (typeof memo !== "string" || memo.length > 200) {
            errors.push(`ondemand[${i}].memo: must be a string of length 0-200`);
          } else {
            memoOut = memo;
          }
        }

        const ondemandOutItem: TimetableOndemand = {
          id: typeof id === "string" ? id : "",
          title: typeof title === "string" ? title : "",
          folders,
        };
        if (memoOut !== undefined) {
          ondemandOutItem.memo = memoOut;
        }
        ondemandOut.push(ondemandOutItem);
      }
      ondemand = ondemandOut;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const result: Timetable = { days, periods, slots, place };
  if (ondemand !== undefined) {
    result.ondemand = ondemand;
  }

  return {
    ok: true,
    timetable: result,
  };
}
