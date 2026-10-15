// Rust 側（src-tauri）のコマンドを呼ぶ窓口。Rust のエラーは "<code>: <説明>" の文字列で返ってくるので、ApiError に直す。
import { invoke } from "@tauri-apps/api/core";
import { ERROR_CODES, type ApiError, type Drive, type EntryRef, type ErrorCode, type SearchQuery, type SearchStats, type SystemInfo, type TextRead } from "../api/types";

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
export type AppDataName = "tags" | "timetables" | "quickaccess" | "recent" | "settings" | "collections" | "grants";

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
  /** 7-Zip が入っているか（入っていなければ、メニューに圧縮・展開を出さない）と、「ここに展開」を出す拡張子（ADR 0021） */
  archiveTool: () => call<{ available: boolean; extensions: string[] }>("archive_tool"),
  /** 7-Zip で圧縮（zip・7z）。作った書庫のパスを返す。7-Zip の画面でやめたら code "denied" */
  archiveCreate: (items: EntryRef[], format: "zip" | "7z") => call<string>("archive_create", { items, format }),
  /** 7-Zip で、書庫を同じフォルダの新しいフォルダへ展開し、そのパスを返す */
  archiveExtract: (item: EntryRef) => call<string>("archive_extract", { item }),
  /** アプリの外からドロップされたファイル（Windows が渡したパス）を移動・コピーする */
  transferPaths: (paths: string[], dest: string, effect: "move" | "copy") => call<number>("transfer_paths", { paths, dest, effect }),
  /** 見張るフォルダを、まるごと置き換える。変わると "folder-changed" が届く */
  watchFolders: (paths: string[]) => call<void>("watch_folders", { paths }),
  // ↓ フォルダの中に置くデータ（.explorer_plus/<name>.json。ADR 0022）。無ければ null
  folderDataRead: (folder: EntryRef, name: string) => call<string | null>("folder_data_read", { folder, name }),
  folderDataWrite: (folder: EntryRef, name: string, text: string) => call<void>("folder_data_write", { folder, name, text }),
  folderDataDelete: (folder: EntryRef, name: string) => call<void>("folder_data_delete", { folder, name }),
  /** マウスの下の窓が、このアプリの窓か（ドラッグ中、ほかの窓が重なっているときに外へ出たと分かるように） */
  cursorOverApp: () => call<boolean>("cursor_over_app"),
  /** 同梱の MOD 開発ガイドのフォルダ */
  modDocsDir: () => call<string>("mod_docs_dir"),
  // ↓ 読み取りの API（ADR 0023）
  fileReadText: (item: EntryRef, offset: number, maxBytes: number) => call<TextRead>("file_read_text", { item, offset, maxBytes }),
  /** そのままのバイト列（ArrayBuffer）で届く */
  fileReadBytes: (item: EntryRef, offset: number, length: number) => call<ArrayBuffer>("file_read_bytes", { item, offset, length }),
  fileUrl: (item: EntryRef) => call<string>("file_url", { item }),
  fileProperties: (items: EntryRef[], names: string[]) => call<(Record<string, unknown> | null)[]>("file_properties", { items, names }),
  searchFind: (folder: EntryRef, query: SearchQuery, depth?: number, limit?: number) =>
    call<{ entries: RawEntry[]; truncated: boolean }>("search_find", { folder, query, depth, limit }),
  searchStats: (folder: EntryRef, depth?: number) =>
    call<Omit<SearchStats, "largest" | "newest"> & { largest: RawEntry[]; newest: RawEntry[] }>("search_stats", { folder, depth }),
  systemDrives: () => call<Drive[]>("system_drives"),
  systemInfo: () => call<SystemInfo>("system_info"),
  /** 本体が MOD の代わりに通信する（ADR 0027）。結果は parseNetFrame で分ける */
  netFetch: (viewId: string, request: { url: string; method: string; headers: [string, string][]; bodyBase64?: string; secret?: string }) =>
    call<ArrayBuffer>("net_fetch", { viewId, request }),
  netUrl: (viewId: string, url: string, secret?: string) => call<string>("net_url", { viewId, url, secret }),
  /** 秘密の設定を資格情報マネージャーに預ける（null で消す） */
  secretSet: (viewId: string, key: string, value: string | null) => call<void>("secret_set", { viewId, key, value }),
  secretStatus: (viewId: string, keys: string[]) => call<boolean[]>("secret_status", { viewId, keys }),
  secretClear: (viewId: string) => call<void>("secret_clear", { viewId }),
  // ↓ 書き込み（ADR 0025）。上書きはしない
  createEntry: (folder: EntryRef, name: string, kind: "file" | "folder", text?: string, base64?: string) =>
    call<RawEntry>("create_entry", { folder, name, kind, text, base64 }),
  createShortcut: (folder: EntryRef, target: EntryRef, name?: string) => call<RawEntry>("create_shortcut", { folder, target, name }),
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
