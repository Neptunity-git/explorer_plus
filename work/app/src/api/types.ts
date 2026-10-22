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
  // ↓ 2026-10-15 に追加（ADR 0022）。フォルダの中（.explorer_plus）に、このビューのデータを保存する
  "folderData",
  // ↓ 2026-10-15 に追加（読み取りの API。ADR 0023）
  /** ファイルの中身を読む（files.readText・readBytes・url） */
  "fileContent",
  /** ファイルの詳しい情報（files.info・properties：撮影日時・曲名・動画の長さなど） */
  "fileInfo",
  /** 下の階層までの検索と集計（search.find・stats） */
  "search",
  /** PC の情報（system.drives・info） */
  "system",
  // ↓ 2026-10-15 に追加（書き込みとコレクション。ADR 0025）
  /** 新しいファイル・フォルダ・ショートカットを作る（上書きはしない。MOD ごとに最初に許可を聞く） */
  "createFiles",
  /** コレクション（仮想ディレクトリ）：ファイルを場所と関係なく集める */
  "collections",
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
  /** 設定の項目（ADR 0024）。書くと、本体が「このビューの設定」の画面を作る。30 個まで */
  settings?: SettingDef[];
  /** 通信する先（https の origin。10 個まで。ADR 0026）。入れるときに利用者に見せる。データ・画像・音や動画・フォント・見た目の部品だけ（スクリプトは不可） */
  network?: string[];
  /** 右クリックのメニューに出す項目（ADR 0036）。ほかのビューのメニューにも「MOD の名前 ▸」として出る。20 個まで */
  menu?: ModMenuItem[];
};

// ---- ほかのビューの右クリックのメニューに出す項目（ADR 0036） ----

/** file・folder：それを選んで右クリック。background：空いている所を右クリック（今のフォルダを渡す） */
export type ModMenuTarget = "file" | "folder" | "background";
export type ModMenuItem = {
  id: string;
  label: string;
  /** 出す場所（省略は3つとも。重なりなし、宣言どおりの順） */
  for?: ModMenuTarget[];
  /** ファイルの拡張子（小文字・点なし）。書くと、選んだファイルが全部これのどれかのときだけ出す */
  ext?: string[];
  /** false なら、1つだけ選んでいるときだけ出す（省略は true） */
  multiple?: boolean;
  /** open（省略時）：MOD のビューを新しいタブで開いて渡す。background：見えない所で動かして渡す */
  run?: "open" | "background";
};
/** 知らせ "menu" の中身。folder は右クリックしたときのタブのフォルダ（無ければ null） */
export type ModMenuEvent = { id: string; items: Entry[]; folder: EntryRef | null };

// ---- MOD の設定（ADR 0024） ----

type SettingBase = { key: string; label: string };
export type SettingDef =
  | (SettingBase & { type: "boolean"; default: boolean })
  | (SettingBase & { type: "number"; default: number; min?: number; max?: number; step?: number })
  | (SettingBase & { type: "text"; default: string; maxLength?: number })
  | (SettingBase & { type: "choice"; default: string; options: { value: string; label: string }[] })
  | (SettingBase & { type: "color"; default: string })
  // 秘密の値（API キーなど。ADR 0027）。本体が資格情報マネージャーに預け、send の宛先に通信するときだけ本体が付ける。
  // MOD には値を見せない（settings.get では「預けてあるか」の true / false だけ）
  | (SettingBase & { type: "secret"; send: SecretSend });
/** 秘密の値の付け方：origin（network に書いた、* の無いもの）に通信するときだけ、ヘッダ（prefix + 値）か URL の ?query= に入れる */
export type SecretSend = { origin: string; header: string; prefix?: string } | { origin: string; query: string };
export type SettingValues = Record<string, boolean | number | string>;

/** コレクション（仮想ディレクトリ。ADR 0025） */
export type Collection = { id: string; name: string; color: string; count: number };

/** ui.choose の選択肢・commands.set のコマンド */
export type ChoiceItem = { id: string; label: string; hint?: string };

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
  /** 短いメモ（教室・持ち物など。0〜200 文字）。省略は「なし」（ADR 0015 判断4） */
  memo?: string;
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
  /** 短いメモ（0〜200 文字）。省略は「なし」 */
  memo?: string;
};

export type CurrentClass = { slot: TimetableSlot; period: TimetablePeriod } | null;

/** views.list で返すビューの情報（ホームで使う） */
export type ViewInfo = { id: string; name: string; description?: string; location: "folder" | "none" };

// ---- 読み取りの API（ADR 0023） ----

/** files.readText の結果 */
export type TextRead = {
  text: string;
  /** ファイル全体の大きさ（バイト） */
  size: number;
  /** offset から読んだバイト数（続きは offset + bytesRead から） */
  bytesRead: number;
  /** まだ続きがあるか */
  truncated: boolean;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "shift_jis";
};

/** files.info の結果。無い値は入らない */
export type FileInfo = {
  /** "JPG ファイル" など（Windows の種類の名前） */
  typeName?: string;
  /** 作成日時（1970年からのミリ秒） */
  created?: number;
  /** 画像・動画の縦横（ピクセル） */
  width?: number;
  height?: number;
  /** 写真の撮影日時（1970年からのミリ秒） */
  dateTaken?: number;
  cameraMaker?: string;
  cameraModel?: string;
  /** 写真の撮影場所（度） */
  latitude?: number;
  longitude?: number;
  title?: string;
  artists?: string[];
  albumArtist?: string;
  album?: string;
  genres?: string[];
  track?: number;
  year?: number;
  /** 曲・動画の長さ（ミリ秒） */
  duration?: number;
  /** ビットレート（bps） */
  bitrate?: number;
  /** 1 秒あたりのフレーム数 */
  frameRate?: number;
  authors?: string[];
  pageCount?: number;
  wordCount?: number;
};

/** search.find の条件。全部省略すると、すべての項目 */
export type SearchQuery = {
  /** 名前に含む文字（大文字・小文字を区別しない）。* と ? があれば名前全体と比べる（例 "*.jpg"） */
  name?: string;
  /** 拡張子（小文字・点なし）のどれか */
  ext?: string[];
  kind?: "file" | "folder";
  minSize?: number;
  maxSize?: number;
  /** 1970年からのミリ秒 */
  modifiedAfter?: number;
  modifiedBefore?: number;
  /** 中身に含む文字（文章のファイルだけ。4MB まで。クラウドにだけあるファイルは見ない） */
  content?: string;
  /** false なら隠し項目を除く */
  hidden?: boolean;
};

export type SearchStats = {
  files: number;
  folders: number;
  bytes: number;
  /** 拡張子ごと（大きい順に 50 まで。拡張子なしは ""） */
  byExt: { ext: string; count: number; bytes: number }[];
  /** 大きいファイル・新しく変わったファイル（20 まで） */
  largest: Entry[];
  newest: Entry[];
  /** 数・時間の上限で途中までになったか */
  truncated: boolean;
};

export type Drive = {
  /** "C:\\" */
  path: string;
  kind: "fixed" | "removable" | "network" | "cdrom" | "ramdisk" | "unknown";
  label: string;
  fileSystem: string;
  /** バイト（取れなければ null） */
  total: number | null;
  free: number | null;
};

export type SystemInfo = {
  /** Windows の強調色 "#rrggbb"（取れなければ null） */
  accent: string | null;
  /** "ja-JP" など */
  locale: string;
};

/** 開いているフォルダの直下で起きた、1件の変化（"changes" の知らせ） */
export type FileChange = {
  kind: "created" | "removed" | "modified" | "renamed";
  path: string;
  name: string;
  /** renamed のときの、前のパス */
  from?: string;
};

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
  /** 見えない所で動いているか（manifest の menu の run が "background"。ADR 0036） */
  background: boolean;
};

/** MOD が右クリックのメニューに足す項目。選ばれると、showMenu の返り値の chosen に id が入る */
export type MenuItem = { id: string; label: string };

/** ドラッグ＆ドロップで落とせる場所（ビューの中のフォルダ）。x・y・width・height は iframe の中の座標（ADR 0015 判断2） */
export type DropTarget = { id: string; path: string; x: number; y: number; width: number; height: number };

/** 画面上の位置（アニメーションの出どころ）。iframe の左上が原点 */
export type Rect = { x: number; y: number; width: number; height: number };

// ---- エラー ----

// "exists" は 2026-10-14 に追加（名前の変更・フォルダの作成で、同じ名前が既にあるとき）
// "network" は 2026-10-15 に追加（本体が代わりに通信して、つながらなかったとき。ADR 0027）
export const ERROR_CODES = ["not-declared", "denied", "not-found", "too-large", "invalid", "io", "exists", "network"] as const;
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
  | "recent.list"
  // ↓ 2026-10-14 に追加（ADR 0015）
  | "clipboard.copy"
  | "clipboard.cut"
  | "clipboard.paste"
  | "drag.start"
  | "drag.targets"
  | "drag.move"
  | "drag.end"
  // ↓ 2026-10-15 に追加（MOD の管理。ADR 0020）。標準のビュー（id が builtin. で始まる）だけが使える
  | "folderData.get"
  | "folderData.set"
  | "folderData.delete"
  // ↓ 2026-10-15 に追加（読み取りの API。ADR 0023）
  | "files.readText"
  | "files.readBytes"
  | "files.url"
  | "files.info"
  | "files.properties"
  | "search.find"
  | "search.stats"
  | "system.drives"
  | "system.info"
  // ↓ 2026-10-15 に追加（本体の画面を使う API。ADR 0024）。uses の宣言は要らない
  | "ui.toast"
  | "ui.status"
  | "ui.tab"
  | "ui.confirm"
  | "ui.ask"
  | "ui.choose"
  | "settings.get"
  | "commands.set"
  // ↓ 2026-10-15 に追加（書き込みとコレクション。ADR 0025）
  | "files.create"
  | "files.createShortcut"
  | "collections.list"
  | "collections.create"
  | "collections.update"
  | "collections.delete"
  | "collections.add"
  | "collections.remove"
  | "collections.entries"
  | "mods.list"
  | "mods.install"
  | "mods.remove"
  | "mods.addDev"
  | "mods.createDev"
  | "mods.pack"
  | "mods.openFolder"
  | "mods.openDocs"
  | "mods.openDevtools"
  // ↓ 2026-10-15 に追加（本体が代わりに通信する。ADR 0027）。manifest の network が要る
  | "net.fetch"
  | "net.url"
  // ↓ 2026-10-15 に追加（ログ・MOD の設定。ADR 0029）。標準のビューだけが使える
  | "logs.list"
  | "logs.sources"
  | "logs.clear"
  | "mods.openSettings"
  // ↓ 2026-10-22 に追加（ADR 0036）。見えない所で動いている MOD が、終わったことを伝える
  | "menu.done";

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
  /** from は 2026-10-15 に追加（ADR 0032）：そのフォルダから下。省略すると今のフォルダから */
  getTree: { depth: number; from?: EntryRef };
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
  "clipboard.copy": { items: EntryRef[] };
  "clipboard.cut": { items: EntryRef[] };
  /** クリップボードのファイルを、ビューが開いているフォルダへ貼り付ける */
  "clipboard.paste": Record<string, never>;
  /** ドラッグを始めた。x・y は iframe の中のマウスの位置。targets はこのビューの中の落とせる場所 */
  "drag.start": { items: EntryRef[]; x: number; y: number; targets: DropTarget[] };
  /** 落とせる場所を知らせ直す（本体から dragTargets の知らせが来たとき） */
  "drag.targets": { targets: DropTarget[] };
  /** ドラッグ中のマウスの位置（iframe の中の座標）。ランタイムが自動で送る */
  "drag.move": { x: number; y: number; ctrl: boolean; shift: boolean };
  /** ボタンを離した（cancel は Esc でやめたとき）。ランタイムが自動で送る */
  "drag.end": { x: number; y: number; ctrl: boolean; shift: boolean; cancel: boolean };
  /** folder についてのデータ（フォルダの中の .explorer_plus/view.<ビューの id>.json）。無ければ undefined。
   *  フォルダを明示するのは、フォルダを移った直後に前のフォルダの分を保存しても、正しいフォルダに入るようにするため */
  "folderData.get": { folder: EntryRef };
  "folderData.set": { folder: EntryRef; value: unknown };
  "folderData.delete": { folder: EntryRef };
  /** offset はバイト。maxBytes は 8MB まで（既定 1MB） */
  "files.readText": { item: EntryRef; offset: number; maxBytes: number };
  /** length は 16MB まで（既定 1MB） */
  "files.readBytes": { item: EntryRef; offset: number; length: number };
  "files.url": { item: EntryRef };
  /** 500 個まで */
  "files.info": { items: EntryRef[] };
  /** Windows の正式な名前（"System.Photo.DateTaken" など）。60 個まで */
  "files.properties": { items: EntryRef[]; names: string[] };
  /** depth は 1〜64（既定 64）、limit は 1〜5000（既定 1000） */
  "search.find": { folder: EntryRef; query: SearchQuery; depth?: number; limit?: number };
  "search.stats": { folder: EntryRef; depth?: number };
  "system.drives": Record<string, never>;
  "system.info": Record<string, never>;
  /** 画面の下に短く出す（200 文字まで）。表示中のタブのビューだけ */
  "ui.toast": { text: string };
  /** 画面の下の状態の欄に出す（120 文字まで。null で消す） */
  "ui.status": { text: string | null };
  /** タブの名前（40 文字まで）とバッジ（8 文字まで）。null で元に戻す・消す。省略は変えない */
  "ui.tab": { title?: string | null; badge?: string | null };
  /** 本体の確かめの画面。表示中のタブのビューだけ（ほかは "denied"） */
  "ui.confirm": { message: string; okLabel?: string };
  "ui.ask": { label: string; value?: string; placeholder?: string; okLabel?: string };
  "ui.choose": { title?: string; items: ChoiceItem[] };
  "settings.get": Record<string, never>;
  /** コマンドの一覧（Ctrl+Shift+P）に出す、このビューのコマンド（50 個まで）。選ばれると "command" が届く */
  "commands.set": { commands: ChoiceItem[] };
  /** folder の中に新しく作る（同じ名前があれば "exists"）。中身は text か bytes（16MB まで）。kind 省略は "file" */
  "files.create": { folder: EntryRef; name: string; kind: "file" | "folder"; text?: string; bytes?: Uint8Array };
  /** target へのショートカット（.lnk）を folder に作る。name は .lnk を付けない名前 */
  "files.createShortcut": { folder: EntryRef; target: EntryRef; name?: string };
  "collections.list": Record<string, never>;
  "collections.create": { name: string; color?: string };
  "collections.update": { id: string; name?: string; color?: string };
  /** 本体が確かめてから消す（中のファイルは消えない） */
  "collections.delete": { id: string };
  "collections.add": { id: string; items: EntryRef[] };
  "collections.remove": { id: string; items: EntryRef[] };
  "collections.entries": { id: string };
  "mods.list": Record<string, never>;
  /** 本体が zip を選ぶ画面と、確かめの画面を出す */
  "mods.install": Record<string, never>;
  "mods.remove": { id: string };
  "mods.addDev": Record<string, never>;
  "mods.createDev": { name: string };
  "mods.pack": { id: string };
  "mods.openFolder": { id: string };
  "mods.openDocs": Record<string, never>;
  "mods.openDevtools": Record<string, never>;
  /** 本体が代わりに通信する。宛先は network に書いた先だけ。body は 4MB まで、返事は 16MB まで。secret は settings の type "secret" の key */
  "net.fetch": { url: string; method: NetMethod; headers: [string, string][]; body?: string | Uint8Array; secret?: string };
  /** 本体が代わりに取ってくる URL（<img> などにそのまま使える） */
  "net.url": { url: string; secret?: string };
  /** source は "app" か MOD の id。古い順に 1000 件まで */
  "logs.list": { source: string };
  /** ログがある出どころ（本体と、ログが残っている MOD） */
  "logs.sources": Record<string, never>;
  "logs.clear": { source: string };
  /** その MOD の設定の画面を出す */
  "mods.openSettings": { id: string };
  /** 見えない所で動いているとき、本体に止めてもらう（ビューのときは何も起きない） */
  "menu.done": Record<string, never>;
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
  "clipboard.copy": null,
  "clipboard.cut": null,
  "clipboard.paste": null,
  "drag.start": null,
  "drag.targets": null,
  "drag.move": null,
  "drag.end": null,
  "folderData.get": "folderData",
  "folderData.set": "folderData",
  "folderData.delete": "folderData",
  "files.readText": "fileContent",
  "files.readBytes": "fileContent",
  "files.url": "fileContent",
  "files.info": "fileInfo",
  "files.properties": "fileInfo",
  "search.find": "search",
  "search.stats": "search",
  "system.drives": "system",
  "system.info": "system",
  "ui.toast": null,
  "ui.status": null,
  "ui.tab": null,
  "ui.confirm": null,
  "ui.ask": null,
  "ui.choose": null,
  "settings.get": null,
  "commands.set": null,
  "files.create": "createFiles",
  "files.createShortcut": "createFiles",
  "collections.list": "collections",
  "collections.create": "collections",
  "collections.update": "collections",
  "collections.delete": "collections",
  "collections.add": "collections",
  "collections.remove": "collections",
  "collections.entries": "collections",
  "mods.list": null,
  "mods.install": null,
  "mods.remove": null,
  "mods.addDev": null,
  "mods.createDev": null,
  "mods.pack": null,
  "mods.openFolder": null,
  "mods.openDocs": null,
  "mods.openDevtools": null,
  // 宛先が manifest の network にあるかは、本体（Rust）が確かめる
  "net.fetch": null,
  "net.url": null,
  "logs.list": null,
  "logs.sources": null,
  "logs.clear": null,
  "mods.openSettings": null,
  "menu.done": null,
};

export type NetMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
export const NET_METHODS: readonly NetMethod[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
/** net.fetch の結果（ランタイムが Response に似た形にして MOD に渡す） */
export type NetResult = { status: number; statusText: string; url: string; headers: [string, string][]; body: Uint8Array };

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
  | { ep: 1; kind: "event"; event: "recent"; data: null }
  // ドラッグ中に、このビューのタブに切り替わった。drag.targets で落とせる場所を知らせてほしい（ADR 0015 判断2）
  | { ep: 1; kind: "event"; event: "dragTargets"; data: null }
  // 入っている MOD が変わった（入れた・外した・開発中の MOD を保存した）。標準のビューだけに届く（ADR 0020）
  | { ep: 1; kind: "event"; event: "mods"; data: null }
  // 開いているフォルダの直下で起きた変化（1件ずつ。少しまとめて届く）。uses に entries があるビューだけに届く（ADR 0023）
  | { ep: 1; kind: "event"; event: "changes"; data: FileChange[] }
  // 設定の画面で値が変わった（ADR 0024）
  | { ep: 1; kind: "event"; event: "settings"; data: SettingValues }
  // コマンドの一覧でこのビューのコマンドが選ばれた
  | { ep: 1; kind: "event"; event: "command"; data: { id: string } }
  // コレクションの一覧・中身が変わった（uses に collections があるビューだけ。ADR 0025）
  | { ep: 1; kind: "event"; event: "collections"; data: Collection[] }
  // 開いているフォルダの、このビューのデータ（folderData）を、ほかのウィンドウが書き換えた（ADR 0030）
  | { ep: 1; kind: "event"; event: "folderData"; data: { path: string } }
  // ログが1件増えた（標準のビューだけに届く。ADR 0029）
  | { ep: 1; kind: "event"; event: "logs"; data: LogEntry }
  // 右クリックのメニューで、manifest の menu の項目が選ばれた（ADR 0036）
  | { ep: 1; kind: "event"; event: "menu"; data: ModMenuEvent };

export type KeyMessage = { ep: 1; kind: "key"; key: string; ctrl: boolean; shift: boolean; alt: boolean };
/** MOD の console.log・エラー（ランタイムが自動で送る。ADR 0029） */
export type LogMessage = { ep: 1; kind: "log"; level: LogLevel; text: string };

// ---- ログ（ADR 0029） ----

export type LogLevel = "info" | "warn" | "error";
/** source は "app"（explorer_plus 本体）か、MOD の id */
export type LogEntry = { t: number; level: LogLevel; source: string; text: string };

/** MOD から本体へ届くメッセージ */
export type ModToHostMessage = CallMessage | KeyMessage | LogMessage;
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
/** クリップボード・ドラッグで一度に扱える項目の数と、ドラッグの落とせる場所の数の上限 */
export const TRANSFER_MAX_ITEMS = 1000;
export const DROP_TARGETS_MAX = 500;
