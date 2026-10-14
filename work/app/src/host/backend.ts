// Rust 側（src-tauri）のコマンドを呼ぶ窓口。Rust のエラーは "<code>: <説明>" の文字列で返ってくるので、ApiError に直す。
import { invoke } from "@tauri-apps/api/core";
import { ERROR_CODES, type ApiError, type EntryRef, type ErrorCode } from "../api/types";

export type RawEntry = {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  hidden: boolean;
  size: number;
  modified: number;
};

export type RawFolder = { id: string; path: string; name: string; parentPath: string | null; entries: RawEntry[] };
export type Place = { kind: string; name: string; path: string };
export type ModSource = { source: "builtin" | "user"; dir: string; manifestText: string | null; error: string | null };
export type Location = { latitude: number; longitude: number; accuracy: number };

export class BackendError extends Error {
  constructor(readonly apiError: ApiError) {
    super(apiError.message);
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof BackendError) return e.apiError;
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const m = /^([a-z-]+): ([\s\S]*)$/.exec(text);
  if (m && (ERROR_CODES as readonly string[]).includes(m[1])) return { code: m[1] as ErrorCode, message: m[2] };
  return { code: "io", message: text };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new BackendError(toApiError(e));
  }
}

export const backend = {
  listDir: (path: string) => call<RawFolder>("list_dir", { path }),
  folderSizes: (paths: string[]) => call<number[]>("folder_sizes", { paths }),
  resolve: (refs: EntryRef[]) => call<(RawEntry | null)[]>("resolve", { refs }),
  openEntry: (item: EntryRef) => call<void>("open_entry", { item }),
  trashEntries: (items: EntryRef[]) => call<number>("trash_entries", { items }),
  listPlaces: () => call<Place[]>("list_places"),
  listMods: () => call<ModSource[]>("list_mods"),
  userModsDir: () => call<string>("user_mods_dir"),
  viewStorageLoad: (viewId: string) => call<string | null>("view_storage_load", { viewId }),
  viewStorageSave: (viewId: string, json: string) => call<void>("view_storage_save", { viewId, json }),
  getLocation: () => call<Location>("get_location"),
};

/** Windows では、Tauri の独自の通信先は http://<名前>.localhost になる */
export const MOD_ORIGIN = "http://mod.localhost";
export const ICON_ORIGIN = "http://icon.localhost";
