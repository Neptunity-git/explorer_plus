import type { CurrentClass, Timetable } from "../api/types";
import { parseTime } from "./timetable";

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const phi1 = a.latitude * DEG_TO_RAD;
  const phi2 = b.latitude * DEG_TO_RAD;
  const dPhi = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dLambda = (b.longitude - a.longitude) * DEG_TO_RAD;

  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function currentClass(
  tt: Timetable,
  now: Date,
  here: { latitude: number; longitude: number; accuracy: number } | null,
): CurrentClass {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  let candidate: { slot: Timetable["slots"][number]; period: Timetable["periods"][number] } | null = null;

  for (const period of tt.periods) {
    const start = parseTime(period.start);
    const end = parseTime(period.end);
    if (start === null || end === null) continue;
    if (minutes < start || minutes >= end) continue;

    const slot = tt.slots.find((s) => s.day === day && s.periodId === period.id);
    if (slot) {
      candidate = { slot, period };
      break;
    }
  }

  if (candidate === null) return null;

  if (tt.place !== null && here !== null) {
    const d = distanceMeters(here, tt.place);
    if (d > tt.place.radius + here.accuracy) return null;
  }

  return candidate;
}
