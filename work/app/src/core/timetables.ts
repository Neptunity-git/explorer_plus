import type { EntryRef, Timetable, TimetablePeriod, TimetableSlot } from "../api/types";
import { sameRef } from "./tags";
import { currentClass } from "./timetable-now";

export type TimetableEntry = { folder: EntryRef; timetable: Timetable };
export type TimetableRegistry = { entries: TimetableEntry[] };
export type NowClass = { folder: EntryRef; slot: TimetableSlot; period: TimetablePeriod };

export function emptyRegistry(): TimetableRegistry {
  return { entries: [] };
}

export function findTimetable(reg: TimetableRegistry, folder: EntryRef): Timetable | null {
  const entry = reg.entries.find((e) => sameRef(e.folder, folder));
  return entry ? entry.timetable : null;
}

export function putTimetable(reg: TimetableRegistry, folder: EntryRef, timetable: Timetable): TimetableRegistry {
  const idx = reg.entries.findIndex((e) => sameRef(e.folder, folder));
  const entries = reg.entries.map((e) => ({ folder: { ...e.folder }, timetable: e.timetable }));
  if (idx === -1) {
    entries.push({ folder: { ...folder }, timetable });
  } else {
    entries[idx] = { folder: { ...folder }, timetable };
  }
  return { entries };
}

export function removeTimetable(reg: TimetableRegistry, folder: EntryRef): TimetableRegistry {
  const entries = reg.entries
    .filter((e) => !sameRef(e.folder, folder))
    .map((e) => ({ folder: { ...e.folder }, timetable: e.timetable }));
  return { entries };
}

export function allCurrent(
  reg: TimetableRegistry,
  now: Date,
  here: { latitude: number; longitude: number; accuracy: number } | null,
): NowClass[] {
  const out: NowClass[] = [];
  for (const entry of reg.entries) {
    const cur = currentClass(entry.timetable, now, here);
    if (cur !== null) {
      out.push({ folder: { ...entry.folder }, slot: cur.slot, period: cur.period });
    }
  }
  return out;
}
