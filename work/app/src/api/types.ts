// ビュー MOD の API（第1版）の型の正本。説明は docs/design/mod-api-v1.md。
// 第1版の約束事は後から変えない・消さない（足すのは、古い MOD が壊れないものだけ）。

/** 本体が対応している apiVersion の範囲 */
export const SUPPORTED_API_VERSIONS = { min: 1, max: 1 } as const;

/** メッセージの約束事の版 */
export const PROTOCOL_VERSION = 1;

// ---- manifest.json ----

/** manifest の uses に書ける名前 */
// "tags"・"timetable" は 2026-10-14 に追加（ADR 0010）
// "quickAccess"・"recent"・"thumbnails" は 2026-10-14 に追加（ADR 0014）
export const USES = [
  "entries",
  "size",
  "folderSize",
  "modified",
  "icons",
  "tree",
  "links",
  "tags",
  "timetable",
  "quickAccess",
  "recent",
  "thumbnails",
] as const;
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
  /** フォルダと関係するか（ADR 0014 判断1）。省略は "folder"。"none" のタブではアドレスバーを隠す */
  location?: "folder" | "none";
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
  /** 付いているタグの id。uses に tags があるときだけ（付いていなければ []） */
  tags?: string[];
  /** Windows が作る縮小画像（サムネイル）。uses に thumbnails があるときだけ。URL の size=（32〜256）で大きさを変えられる */
  thumbnailUrl?: string;
};

// ---- タグ（ADR 0010。アプリ全体で1つ） ----

export type Tag = {
  /** 本体が付ける。"tag-" で始まる */
  id: string;
  /** 1〜40 文字。大文字小文字を区別せずに、ほかのタグと重ならない */
  name: string;
  /** "#rrggbb"（16進数、小文字） */
  color: string;
};

// ---- 時間割（ADR 0010。アプリ全体で1つ。すべてユーザーが設定する） ----

export type TimetablePeriod = {
  /** 1〜32 文字。時間割の中で重ならない */
  id: string;
  /** 表示名（"1限" など）。1〜20 文字 */
  label: string;
  /** "HH:MM"（24時間、"00:00"〜"23:59"）。start < end */
  start: string;
  end: string;
};

export type TimetableSlot = {
  /** 0=日曜 … 6=土曜（Date.getDay() と同じ） */
  day: number;
  periodId: string;
  /** 授業名。0〜60 文字 */
  title: string;
  /** 結びつけるフォルダ（0〜5 個。今の画面は1つ目だけを使う） */
  folders: EntryRef[];
};

/** 「この場所にいるときだけ今の授業を出す」の場所。radius はメートル */
export type TimetablePlace = { latitude: number; longitude: number; radius: number };

export type Timetable = {
  /** 表に出す曜日（0〜6、小さい順・重なりなし） */
  days: number[];
  periods: TimetablePeriod[];
  slots: TimetableSlot[];
  /** null なら場所の条件を使わない（時刻だけで判定） */
  place: TimetablePlace | null;
  /** オンデマンドの授業（曜日・時限なし。ADR 0012 判断2）。省略は「なし」 */
  ondemand?: TimetableOndemand[];
};

export type TimetableOndemand = {
  /** 1〜32 文字。オンデマンドの中で重ならない */
  id: string;
  /** 授業名。1〜60 文字 */
  title: string;
  /** 結びつけるフォルダ（0〜5 個） */
  folders: EntryRef[];
};

export type CurrentClass = { slot: TimetableSlot; period: TimetablePeriod } | null;

/** views.list で返すビューの情報（ホームで使う） */
export type ViewInfo = { id: string; name: string; description?: string; location: "folder" | "none" };

export type FolderSnapshot = {
  /** フォルダ自身のファイルID（取れなければ ""）。ノートビューなど、フォルダごとに何かを覚えるときに使う */
  id: string;
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

/** MOD が右クリックのメニューに足す項目。選ばれると、showMenu の返り値の chosen に id が入る */
export type MenuItem = { id: string; label: string };

/** 画面上の位置（アニメーションの出どころ）。iframe の左上が原点 */
export type Rect = { x: number; y: number; width: number; height: number };

// ---- エラー ----

// "exists" は 2026-10-14 に追加（名前の変更・フォルダの作成で、同じ名前が既にあるとき）
export const ERROR_CODES = ["not-declared", "denied", "not-found", "too-large", "invalid", "io", "exists"] as const;
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
  | "resolve"
  // ↓ 2026-10-14 に追加（Win11 の操作を受け継ぐ。ADR 0009）
  | "rename"
  | "createFolder"
  | "showMenu"
  // ↓ 2026-10-14 に追加（タグと時間割。ADR 0010）
  | "tags.list"
  | "tags.create"
  | "tags.update"
  | "tags.delete"
  | "tags.assign"
  | "tags.entries"
  | "timetable.get"
  | "timetable.set"
  | "timetable.current"
  // ↓ 2026-10-14 に追加（ADR 0012・0014）
  | "timetable.delete"
  | "views.list"
  | "tabs.open"
  | "quickAccess.list"
  | "quickAccess.pin"
  | "quickAccess.unpin"
  | "recent.list";

/** method ごとの params の形 */
export type CallParams = {
  ready: Record<string, never>;
  /** newTab は 2026-10-14 に追加：フォルダを新しいタブ（標準のビュー）で開く */
  open: { id: string; path: string; from?: Rect; newTab?: boolean };
  navigate: { path: string };
  navigateUp: Record<string, never>;
  trash: { items: EntryRef[]; from?: Rect };
  "storage.get": { key: string };
  "storage.set": { key: string; value: unknown };
  "storage.delete": { key: string };
  "storage.keys": Record<string, never>;
  getTree: { depth: number };
  resolve: { refs: EntryRef[] };
  rename: { id: string; path: string; newName: string };
  /** name は 2026-10-14 に追加。省略すると「新しいフォルダー」（重ならない番号付き） */
  createFolder: { name?: string };
  showMenu: { x: number; y: number; items: EntryRef[]; extra?: MenuItem[] };
  "tags.list": Record<string, never>;
  "tags.create": { name: string; color: string };
  "tags.update": { id: string; name?: string; color?: string };
  "tags.delete": { id: string };
  "tags.assign": { items: EntryRef[]; tagId: string; on: boolean };
  "tags.entries": { tagId: string };
  "timetable.get": Record<string, never>;
  /** timetable の形の細かい検査は本体（src/core/timetable.ts の validateTimetable）が行う */
  /** 時間割は、ビューが開いているフォルダのもの（ADR 0012）。get は無ければ null */
  "timetable.set": { timetable: unknown };
  "timetable.current": Record<string, never>;
  "timetable.delete": Record<string, never>;
  "views.list": Record<string, never>;
  /** 新しいタブを開く。path を省略すると、フォルダと関係するビューでは今のフォルダ */
  /** replace：新しいタブではなく、このビューのタブで開く（ホームから開くとき） */
  "tabs.open": { viewId: string; path?: string; replace?: boolean };
  "quickAccess.list": Record<string, never>;
  "quickAccess.pin": { items: EntryRef[] };
  "quickAccess.unpin": { items: EntryRef[] };
  "recent.list": Record<string, never>;
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
  rename: null,
  createFolder: null,
  showMenu: null,
  "tags.list": "tags",
  "tags.create": "tags",
  "tags.update": "tags",
  "tags.delete": "tags",
  "tags.assign": "tags",
  "tags.entries": "tags",
  "timetable.get": "timetable",
  "timetable.set": "timetable",
  "timetable.current": "timetable",
  "timetable.delete": "timetable",
  "views.list": null,
  "tabs.open": null,
  "quickAccess.list": "quickAccess",
  "quickAccess.pin": "quickAccess",
  "quickAccess.unpin": "quickAccess",
  "recent.list": "recent",
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
  | { ep: 1; kind: "event"; event: "theme"; data: "light" | "dark" }
  // 本体がビューに「この項目の名前の変更を始めて」と頼む（メニューの「名前の変更」、新しいフォルダを作った直後）
  | { ep: 1; kind: "event"; event: "action"; data: { action: "rename"; entry: Entry } }
  // タグの一覧・時間割が変わったとき（uses に tags・timetable があるビューだけに届く）
  | { ep: 1; kind: "event"; event: "tags"; data: Tag[] }
  // 時間割は、ビューが開いているフォルダのもの（無ければ null）。フォルダが変わったときにも届く（ADR 0012）
  | { ep: 1; kind: "event"; event: "timetable"; data: Timetable | null }
  // クイックアクセス・最近使った項目が変わった（中身は quickAccess.list・recent.list で取り直す）
  | { ep: 1; kind: "event"; event: "quickAccess"; data: null }
  | { ep: 1; kind: "event"; event: "recent"; data: null };

export type KeyMessage = { ep: 1; kind: "key"; key: string; ctrl: boolean; shift: boolean; alt: boolean };

/** MOD から本体へ届くメッセージ */
export type ModToHostMessage = CallMessage | KeyMessage;
/** 本体から MOD へ送るメッセージ */
export type HostToModMessage = ResultMessage | EventMessage;

// ---- 制限 ----

/** storage の1つの値の上限（JSON にしたときの UTF-8 のバイト数） */
export const STORAGE_VALUE_MAX_BYTES = 1024 * 1024;
export const RESOLVE_MAX_REFS = 100;
/** showMenu の items（選んでいる項目）の上限 */
export const MENU_MAX_ITEMS = 1000;
/** showMenu の extra（MOD が足す項目）の上限と、ラベルの長さの上限 */
export const MENU_MAX_EXTRA = 20;
export const MENU_LABEL_MAX = 60;
export const TREE_DEPTH = { min: 1, max: 5 } as const;
/** タグの名前の長さの上限と、タグの数の上限 */
export const TAG_NAME_MAX = 40;
export const TAGS_MAX = 200;
/** tags.assign の items の上限 */
export const TAG_ASSIGN_MAX_ITEMS = 1000;
/** クイックアクセスの pin・unpin で一度に渡せる数 */
export const QUICK_ACCESS_MAX_ITEMS = 100;
