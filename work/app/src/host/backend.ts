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
export type ModSource = { source: "builtin" | "user" | "dev"; dir: string; manifestText: string | null; error: string | null };
export type Location = { latitude: number; longitude: number; accuracy: number };
/** アプリ全体のデータの名前（Rust の mods.rs の APP_DATA_NAMES と同じ） */
export type AppDataName = "tags" | "timetables" | "quickaccess" | "recent";

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

export type OneDriveAction = "share" | "copyLink" | "manageAccess" | "viewOnline";

export const backend = {
  listDir: (path: string) => call<RawFolder>("list_dir", { path }),
  folderSizes: (paths: string[]) => call<number[]>("folder_sizes", { paths }),
  resolve: (refs: EntryRef[]) => call<(RawEntry | null)[]>("resolve", { refs }),
  openEntry: (item: EntryRef) => call<void>("open_entry", { item }),
  trashEntries: (items: EntryRef[]) => call<number>("trash_entries", { items }),
  renameEntry: (item: EntryRef, newName: string) => call<RawEntry>("rename_entry", { item, newName }),
  createFolder: (parent: string, name: string) => call<RawEntry>("create_folder", { parent, name }),
  listPlaces: () => call<Place[]>("list_places"),
  listMods: () => call<ModSource[]>("list_mods"),
  // ↓ MOD を入れる・外す・作る（ADR 0020）
  pickModZip: () => call<string | null>("pick_mod_zip"),
  modInspect: (zipPath: string) =>
    call<{ staging: string; manifestText: string; files: number; bytes: number; installedVersion: string | null }>("mod_inspect", { zipPath }),
  modInstall: (staging: string) => call<string>("mod_install", { staging }),
  modDiscard: (staging: string) => call<void>("mod_discard", { staging }),
  modRemove: (id: string) => call<void>("mod_remove", { id }),
  devModAdd: () => call<string | null>("dev_mod_add"),
  devModCreate: (name: string) => call<string | null>("dev_mod_create", { name }),
  modPack: (id: string) => call<string>("mod_pack", { id }),
  openModDocs: () => call<void>("open_mod_docs"),
  openDevtools: () => call<void>("open_devtools"),
  userModsDir: () => call<string>("user_mods_dir"),
  viewStorageLoad: (viewId: string) => call<string | null>("view_storage_load", { viewId }),
  viewStorageSave: (viewId: string, json: string) => call<void>("view_storage_save", { viewId, json }),
  getLocation: () => call<Location>("get_location"),
  devStartDir: () => call<string | null>("dev_start_dir"),
  appDataLoad: (name: AppDataName) => call<string | null>("app_data_load", { name }),
  appDataSave: (name: AppDataName, json: string) => call<void>("app_data_save", { name, json }),
  fileIds: (paths: string[]) => call<string[]>("file_ids", { paths }),
  clipboardSet: (items: EntryRef[], cut: boolean) => call<void>("clipboard_set", { items, cut }),
  clipboardPaste: (dest: string) => call<number>("clipboard_paste", { dest }),
  openWith: (item: EntryRef) => call<void>("open_with", { item }),
  transfer: (items: EntryRef[], dest: string, effect: "move" | "copy") => call<number>("transfer", { items, dest, effect }),
  /** 圧縮（zip・7z）。作った書庫のパスを返す（ADR 0021） */
  archiveCreate: (items: EntryRef[], format: "zip" | "7z") => call<string>("archive_create", { items, format }),
  /** 書庫（zip・7z・tar・tar.gz）を同じフォルダの新しいフォルダへ展開し、そのパスを返す */
  archiveExtract: (item: EntryRef) => call<string>("archive_extract", { item }),
  /** アプリの外からドロップされたファイル（Windows が渡したパス）を移動・コピーする */
  transferPaths: (paths: string[], dest: string, effect: "move" | "copy") => call<number>("transfer_paths", { paths, dest, effect }),
  /** 見張るフォルダを、まるごと置き換える。変わると "folder-changed" が届く */
  watchFolders: (paths: string[]) => call<void>("watch_folders", { paths }),
  /** OneDrive の中のファイル・フォルダか */
  onedriveContains: (item: EntryRef) => call<boolean>("onedrive_contains", { item }),
  /** OneDrive の操作。Windows のメニューの項目を呼び、画面は OneDrive が出す */
  onedriveAction: (item: EntryRef, action: OneDriveAction) => call<void>("onedrive_action", { item, action }),
  /** アプリの外へのドラッグ。落とされる（取りやめる）まで戻らない */
  dragOut: (items: EntryRef[]) => call<"dropped" | "cancelled">("drag_out", { items }),
  pathKind: (path: string) => call<"dir" | "file" | "none">("path_kind", { path }),
  runCommand: (file: string, args: string, cwd: string) => call<void>("run_command", { file, args, cwd }),
};

/** Windows では、Tauri の独自の通信先は http://<名前>.localhost になる */
export const MOD_ORIGIN = "http://mod.localhost";
export const ICON_ORIGIN = "http://icon.localhost";
