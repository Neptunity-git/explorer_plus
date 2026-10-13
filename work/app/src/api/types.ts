// ビュー MOD の API（第1版）の型の正本。説明は docs/design/mod-api-v1.md。
// 第1版の約束事は後から変えない・消さない（足すのは、古い MOD が壊れないものだけ）。

/** 本体が対応している apiVersion の範囲 */
export const SUPPORTED_API_VERSIONS = { min: 1, max: 1 } as const;

/** メッセージの約束事の版 */
export const PROTOCOL_VERSION = 1;

// ---- manifest.json ----

/** manifest の uses に書ける名前 */
export const USES = ["entries", "size", "folderSize", "modified", "icons", "tree", "links"] as const;
export type Use = (typeof USES)[number];

export type Manifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
  /** 重複を除いた、宣言どおりの順 */
  uses: Use[];
  description?: string;
};

// ---- データ ----

export type IconKind = "launch" | "config" | "system";

export type Entry = {
  /** ファイルID。"<ボリュームの番号16桁>:<ファイルの番号32桁>"（16進数、小文字） */
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  /** 小文字・点なし。拡張子が無い・フォルダなら "" */
  ext: string;
  hidden: boolean;
  /** バイト。uses に size（フォルダは folderSize）があるときだけ */
  size?: number;
  /** 1970年からのミリ秒。uses に modified があるときだけ */
  modified?: number;
  /** uses に icons があるときだけ */
  iconUrl?: string;
  /** uses に icons があるときだけ */
  iconKind?: IconKind;
};

export type FolderSnapshot = {
  path: string;
  name: string;
  /** ドライブの直下（"C:\\"）なら null */
  parentPath: string | null;
  entries: Entry[];
};

export type TreeNode = {
  entry: Entry;
  /** フォルダで、depth の範囲内なら子の一覧。範囲外・ファイルなら undefined */
  children?: TreeNode[];
};

/** 保存しておくファイルの指し示し方（ADR 0005） */
export type EntryRef = { id: string; path: string };

export type ViewContext = {
  apiVersion: number;
  viewId: string;
  tabId: string;
  theme: "light" | "dark";
};

/** 画面上の位置（アニメーションの出どころ）。iframe の左上が原点 */
export type Rect = { x: number; y: number; width: number; height: number };

// ---- エラー ----

export const ERROR_CODES = ["not-declared", "denied", "not-found", "too-large", "invalid", "io"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiError = { code: ErrorCode; message: string };

// ---- 本体と MOD のあいだのメッセージ ----

export type CallMethod =
  | "ready"
  | "open"
  | "navigate"
  | "navigateUp"
  | "trash"
  | "storage.get"
  | "storage.set"
  | "storage.delete"
  | "storage.keys"
  | "getTree"
  | "resolve";

/** method ごとの params の形 */
export type CallParams = {
  ready: Record<string, never>;
  open: { id: string; path: string; from?: Rect };
  navigate: { path: string };
  navigateUp: Record<string, never>;
  trash: { items: EntryRef[]; from?: Rect };
  "storage.get": { key: string };
  "storage.set": { key: string; value: unknown };
  "storage.delete": { key: string };
  "storage.keys": Record<string, never>;
  getTree: { depth: number };
  resolve: { refs: EntryRef[] };
};

/** method を呼ぶのに要る uses。null なら宣言不要 */
export const METHOD_REQUIRES: Record<CallMethod, Use | null> = {
  ready: null,
  open: null,
  navigate: null,
  navigateUp: null,
  trash: null,
  "storage.get": null,
  "storage.set": null,
  "storage.delete": null,
  "storage.keys": null,
  getTree: "tree",
  resolve: "links",
};

export type CallMessage = {
  ep: 1;
  kind: "call";
  id: number;
  method: CallMethod;
  params: Record<string, unknown>;
};

export type ResultMessage =
  | { ep: 1; kind: "result"; id: number; ok: true; value: unknown }
  | { ep: 1; kind: "result"; id: number; ok: false; error: ApiError };

export type EventMessage =
  | { ep: 1; kind: "event"; event: "folder"; data: FolderSnapshot }
  | { ep: 1; kind: "event"; event: "theme"; data: "light" | "dark" };

export type KeyMessage = { ep: 1; kind: "key"; key: string; ctrl: boolean; shift: boolean; alt: boolean };

/** MOD から本体へ届くメッセージ */
export type ModToHostMessage = CallMessage | KeyMessage;
/** 本体から MOD へ送るメッセージ */
export type HostToModMessage = ResultMessage | EventMessage;

// ---- 制限 ----

/** storage の1つの値の上限（JSON にしたときの UTF-8 のバイト数） */
export const STORAGE_VALUE_MAX_BYTES = 1024 * 1024;
export const RESOLVE_MAX_REFS = 100;
export const TREE_DEPTH = { min: 1, max: 5 } as const;
