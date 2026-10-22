// explorer_plus のビュー MOD の API（第1版）の型。TUI 風の部品は /__runtime/tui.css と /__runtime/tui.js。
// manifest.json には location（"folder" か "none"）も書ける。MOD のフォルダにコピーするか、/// <reference path="…"> で読み込むと、
// window.explorerPlus の補完とエラーチェックが効く（ADR 0007 判断1）。
// 約束事の説明：docs/design/mod-api-v1.md（本体の型の正本は src/api/types.ts。食い違ったら本体の型が正しい）

export {};

declare global {
  interface Window {
    explorerPlus: ExplorerPlus.Api;
  }

  namespace ExplorerPlus {
    type IconKind = "launch" | "config" | "system";

    interface Entry {
      /** ファイルID。名前変更・移動で変わらない。ファイルID の無いドライブ（FAT の USB メモリなど）では "" */
      id: string;
      name: string;
      path: string;
      kind: "file" | "folder";
      /** 小文字・点なし。拡張子が無い・フォルダなら "" */
      ext: string;
      hidden: boolean;
      /** manifest の uses に "size"（フォルダは "folderSize"）があるときだけ */
      size?: number;
      /** uses に "modified" があるときだけ（1970年からのミリ秒） */
      modified?: number;
      /** uses に "icons" があるときだけ */
      iconUrl?: string;
      iconKind?: IconKind;
      /** uses に "tags" があるときだけ（付いているタグの id） */
      tags?: string[];
      /** uses に "thumbnails" があるときだけ。Windows の縮小画像。URL の size=（32〜256）で大きさを変えられる */
      thumbnailUrl?: string;
    }

    /** manifest の settings の1項目（ADR 0024） */
    type SettingDef =
      | { key: string; label: string; type: "boolean"; default: boolean }
      | { key: string; label: string; type: "number"; default: number; min?: number; max?: number; step?: number }
      | { key: string; label: string; type: "text"; default: string; maxLength?: number }
      | { key: string; label: string; type: "choice"; default: string; options: { value: string; label: string }[] }
      | { key: string; label: string; type: "color"; default: string }
      /**
       * 秘密の値（API キーなど。ADR 0027）。利用者が設定の画面で入れると、本体が Windows の資格情報マネージャーに預ける。
       * ビューには値を見せない（settings.get では、預けてあれば true）。net.fetch・net.url で { secret: key } を付けると、
       * send.origin への通信のときだけ、本体がヘッダ（prefix + 値）か URL の ?query= に入れて送る
       */
      | { key: string; label: string; type: "secret"; send: { origin: string; header: string; prefix?: string } | { origin: string; query: string } };
    type SettingValues = Record<string, boolean | number | string>;

    /** net.fetch の引数（ADR 0027） */
    type NetOptions = {
      /** 既定は "GET" */
      method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
      /** Cookie・User-Agent・Referer・Origin などは付けられない（本体が決める） */
      headers?: Record<string, string> | [string, string][] | Headers;
      /** 4MB まで */
      body?: string | Uint8Array | ArrayBuffer;
      /** JSON にして body に入れる（Content-Type も付ける） */
      json?: unknown;
      /** settings の type "secret" の key。その send.origin への通信のときだけ、本体が値を付ける */
      secret?: string;
    };
    /** net.fetch の結果。fetch の Response に似た形（中身は 16MB まで） */
    type NetResponse = {
      readonly ok: boolean;
      readonly status: number;
      readonly statusText: string;
      /** 転送（リダイレクト）のあとの URL。秘密の値は入らない */
      readonly url: string;
      readonly headers: Headers;
      text(): Promise<string>;
      json(): Promise<any>;
      bytes(): Promise<Uint8Array>;
      arrayBuffer(): Promise<ArrayBuffer>;
      blob(): Promise<Blob>;
    };
    /** コレクション（仮想ディレクトリ。ADR 0025） */
    interface Collection {
      id: string;
      name: string;
      /** "#rrggbb" */
      color: string;
      /** 入っている数 */
      count: number;
    }
    /** 選択肢・コマンド */
    interface ChoiceItem {
      id: string;
      label: string;
      hint?: string;
    }
    /** files.readText の結果（ADR 0023） */
    interface TextRead {
      text: string;
      /** ファイル全体の大きさ（バイト） */
      size: number;
      /** offset から読んだバイト数。続きは offset + bytesRead から読む */
      bytesRead: number;
      /** まだ続きがあるか */
      truncated: boolean;
      encoding: "utf-8" | "utf-16le" | "utf-16be" | "shift_jis";
    }
    /** files.info の結果。無い値は入らない */
    interface FileInfo {
      typeName?: string;
      /** 1970年からのミリ秒 */
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
      bitrate?: number;
      /** 1 秒あたりのフレーム数 */
      frameRate?: number;
      authors?: string[];
      pageCount?: number;
      wordCount?: number;
    }
    /** search.find の条件。全部省略すると、すべての項目 */
    interface SearchQuery {
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
    }
    interface SearchStats {
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
    }
    interface Drive {
      /** "C:\\" */
      path: string;
      kind: "fixed" | "removable" | "network" | "cdrom" | "ramdisk" | "unknown";
      label: string;
      fileSystem: string;
      /** バイト（取れなければ null） */
      total: number | null;
      free: number | null;
    }
    interface SystemInfo {
      /** Windows の強調色 "#rrggbb"（取れなければ null） */
      accent: string | null;
      /** "ja-JP" など */
      locale: string;
    }
    /** 開いているフォルダの直下で起きた1件の変化 */
    interface FileChange {
      kind: "created" | "removed" | "modified" | "renamed";
      path: string;
      name: string;
      /** renamed のときの、前のパス */
      from?: string;
    }
    interface FolderSnapshot {
      /** フォルダ自身のファイルID（取れなければ ""）。フォルダごとに何かを覚えるときに使う */
      id: string;
      path: string;
      name: string;
      parentPath: string | null;
      entries: Entry[];
    }

    interface TreeNode {
      entry: Entry;
      children?: TreeNode[];
    }

    /** 保存しておくファイルの指し示し方 */
    interface EntryRef {
      id: string;
      path: string;
    }

    interface ViewContext {
      apiVersion: number;
      viewId: string;
      tabId: string;
      theme: "light" | "dark";
      /** 見えない所で動いているか（manifest の menu の run が "background" の項目が選ばれた。2026-10-22 に追加） */
      background: boolean;
    }

    /** manifest の menu の項目が選ばれた（2026-10-22 に追加）。folder は右クリックしたタブのフォルダ */
    interface MenuEvent {
      id: string;
      /** 選んでいたもの（空いている所の右クリックなら []） */
      items: Entry[];
      folder: EntryRef | null;
    }

    /** 画面上の位置。DOMRect をそのまま渡してよい */
    type RectLike = { x: number; y: number; width: number; height: number } | DOMRect;

    interface MenuItem {
      id: string;
      label: string;
    }

    interface Tag {
      id: string;
      name: string;
      /** "#rrggbb" */
      color: string;
    }

    interface TimetablePeriod {
      id: string;
      label: string;
      /** "HH:MM" */
      start: string;
      end: string;
    }

    interface TimetableSlot {
      /** 0=日曜 … 6=土曜 */
      day: number;
      periodId: string;
      title: string;
      folders: EntryRef[];
      /** 短いメモ（0〜200 文字） */
      memo?: string;
    }

    interface Timetable {
      days: number[];
      periods: TimetablePeriod[];
      slots: TimetableSlot[];
      place: { latitude: number; longitude: number; radius: number } | null;
      /** オンデマンドの授業（曜日・時限なし）。省略は「なし」 */
      ondemand?: { id: string; title: string; folders: EntryRef[]; memo?: string }[];
    }

    interface ViewInfo {
      id: string;
      name: string;
      description?: string;
      /** "none" はフォルダと関係ないビュー（manifest の location） */
      location: "folder" | "none";
    }

    type CurrentClass = { slot: TimetableSlot; period: TimetablePeriod } | null;

    type ErrorCode = "not-declared" | "denied" | "not-found" | "too-large" | "invalid" | "io" | "exists" | "network";

    /** 失敗した呼び出しの Promise は、code の付いた Error で失敗する */
    interface ApiError extends Error {
      code: ErrorCode;
    }

    interface Api {
      readonly apiVersion: 1;
      /** 本体とつながったら解決する（ランタイムが読み込み時に自動で呼んでいる） */
      ready(): Promise<ViewContext>;
      /** 今のフォルダ。最初に1回、以後は中身が変わるたびに呼ばれる。戻り値を呼ぶと止まる */
      onFolder(cb: (folder: FolderSnapshot) => void): () => void;
      onTheme(cb: (theme: "light" | "dark") => void): () => void;
      readonly theme: "light" | "dark";

      /** ファイルは既定のアプリで開く。フォルダはこのタブで移動（newTab: true なら新しいタブで開く） */
      open(entry: EntryRef, opts?: { from?: RectLike; newTab?: boolean }): Promise<void>;
      navigate(path: string): Promise<void>;
      navigateUp(): Promise<void>;
      /** 本体が確認してから、ごみ箱へ送る。ユーザーがやめたら code "denied" で失敗する */
      trash(entries: EntryRef[], opts?: { from?: RectLike }): Promise<{ trashed: number }>;

      /** このビュー専用の保存場所（JSON にできる値。1つの値は 1MB まで） */
      readonly storage: {
        get(key: string): Promise<unknown>;
        set(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<void>;
        keys(): Promise<string[]>;
      };

      /**
       * uses に "folderData" が要る（ADR 0022）。フォルダ（onFolder で届いたもの）についてのデータ（JSON にできる値。1MB まで）を、
       * フォルダの中の隠しフォルダ .explorer_plus に保存する。OneDrive などで同期すれば、別の PC の explorer_plus でも同じものが出る。
       * 書けないフォルダ（C:\ の直下など）では、代わりにこのビューの保存場所に置く。無ければ get は undefined
       */
      readonly folderData: {
        get(folder: EntryRef): Promise<unknown>;
        set(folder: EntryRef, value: unknown): Promise<void>;
        delete(folder: EntryRef): Promise<void>;
      };
      /**
       * 開いているフォルダのこのビューのデータを、ほかのウィンドウ（同じビューで同じフォルダを開いている）が書き換えた（ADR 0030）。
       * folderData.get で読み直すと、ウィンドウのあいだで食い違わない
       */
      onFolderData(cb: (data: { path: string }) => void): () => void;
      /**
       * uses に "fileContent" が要る（ADR 0023）。ファイルの中身を読む。
       * readText は文字コード（UTF-8・UTF-16・Shift_JIS）を見分けて文字にする。maxBytes は 8MB まで（既定 1MB）。
       * readBytes は length が 16MB まで（既定 1MB）。url は <img>・<video>・<audio>・fetch にそのまま使える URL（動画のシークもできる）。
       * uses に "fileInfo" が要る：info は撮影日時・撮影場所・曲名・動画の長さなど。properties は Windows の正式な名前（"System.*"）で聞く
       */
      readonly files: {
        readText(entry: EntryRef, opts?: { offset?: number; maxBytes?: number }): Promise<TextRead>;
        readBytes(entry: EntryRef, opts?: { offset?: number; length?: number }): Promise<Uint8Array>;
        url(entry: EntryRef): Promise<string>;
        info(entries: EntryRef[]): Promise<(FileInfo | null)[]>;
        properties(entries: EntryRef[], names: string[]): Promise<(Record<string, unknown> | null)[]>;
        /**
         * uses に "createFiles" が要る（ADR 0025）。folder の中に新しく作る（同じ名前があれば "exists"。上書きはしない）。
         * 中身は text か bytes（16MB まで）。最初に使うとき、本体が利用者に許可を聞く（断られたら "denied"）
         */
        create(folder: EntryRef, name: string, opts?: { kind?: "file" | "folder"; text?: string; bytes?: Uint8Array }): Promise<Entry>;
        /** target へのショートカット（.lnk）を folder に作る。name は .lnk を付けない名前（省略は「元の名前 - ショートカット」） */
        createShortcut(folder: EntryRef, target: EntryRef, opts?: { name?: string }): Promise<Entry>;
      };
      /**
       * uses に "collections" が要る（ADR 0025）。コレクション（仮想ディレクトリ）：ファイル・フォルダを、場所と関係なく集めて名前を付けたもの。
       * アプリ全体で1つ（どの MOD からも同じものが見える）。中身はファイルID で覚えるので、名前変更・移動しても外れない。
       * delete は本体が確かめてから消す（中のファイルは消えない）。entries の missing は、見つからなくなったもの
       */
      /**
       * 本体が代わりに通信する（ADR 0027）。宛先は manifest の network に書いた先だけ（転送の先も確かめる）。
       * ブラウザの決まり（CORS）を受けず、「explorer_plus の、この MOD から」と名乗る（User-Agent）。クッキーは送らない。
       * つながらないときは "network"、network に無い先は "not-declared"、秘密の値がまだ無いときは "not-found"
       */
      readonly net: {
        fetch(url: string, opts?: NetOptions): Promise<NetResponse>;
        /** <img>・<audio>・CSS の url() などにそのまま使える URL。同じ URL には同じものを返す */
        url(url: string, opts?: { secret?: string }): Promise<string>;
      };
      readonly collections: {
        list(): Promise<Collection[]>;
        create(name: string, opts?: { color?: string }): Promise<Collection>;
        update(id: string, patch: { name?: string; color?: string }): Promise<Collection>;
        delete(id: string): Promise<void>;
        add(id: string, entries: EntryRef[]): Promise<void>;
        remove(id: string, entries: EntryRef[]): Promise<void>;
        entries(id: string): Promise<{ entries: Entry[]; missing: EntryRef[] }>;
      };
      onCollections(cb: (collections: Collection[]) => void): () => void;
      /**
       * uses に "search" が要る（ADR 0023）。下の階層までの検索と集計。リンク（ジャンクション）の先へは入らない。
       * depth は 1〜64（既定 64）、limit は 1〜5000（既定 1000）。数・時間の上限で途中までのときは truncated: true
       */
      readonly search: {
        find(folder: EntryRef, query?: SearchQuery, opts?: { depth?: number; limit?: number }): Promise<{ entries: Entry[]; truncated: boolean }>;
        stats(folder: EntryRef, opts?: { depth?: number }): Promise<SearchStats>;
      };
      /** uses に "system" が要る（ADR 0023）。ドライブと空き容量・強調色・言語 */
      readonly system: {
        drives(): Promise<Drive[]>;
        info(): Promise<SystemInfo>;
      };
      /** 開いているフォルダの直下で起きた変化（少しまとめて届く。フォルダの中身の onFolder の後）。uses に "entries" が要る */
      onChanges(cb: (changes: FileChange[]) => void): () => void;
      /**
       * 本体の画面を使う（ADR 0024。uses は要らない）。お知らせ・確かめ・入力・選択は、表示中のタブのビューだけが出せる（ほかは "denied"）。
       * confirm はやめたら false、ask・choose はやめたら null
       */
      readonly ui: {
        toast(text: string): Promise<void>;
        status(text: string | null): Promise<void>;
        tab(opts: { title?: string | null; badge?: string | null }): Promise<void>;
        confirm(message: string, opts?: { okLabel?: string }): Promise<boolean>;
        ask(opts: { label: string; value?: string; placeholder?: string; okLabel?: string }): Promise<string | null>;
        choose(items: ChoiceItem[], opts?: { title?: string }): Promise<string | null>;
      };
      /** manifest の settings の値（ADR 0024）。設定の画面は本体が作る（タブの ▸・タブの右クリック・コマンドの一覧から開く） */
      readonly settings: { get(): Promise<SettingValues> };
      onSettings(cb: (values: SettingValues) => void): () => void;
      /** コマンドの一覧（Ctrl+Shift+P）に出すコマンド（50 個まで。呼ぶたびに置き換える） */
      readonly commands: { set(list: ChoiceItem[]): Promise<void> };
      onCommand(cb: (id: string) => void): () => void;
      /** manifest の menu の項目が、右クリックのメニュー（ほかのビューのものも）で選ばれた。onMenu を呼ぶ前に届いた分も渡す */
      onMenu(cb: (event: MenuEvent) => void): () => void;
      /** 見えない所で動いているとき、終わったことを伝える（本体が止める）。ビューのときは何も起きない */
      readonly menu: { done(): Promise<void> };
      /** uses に "tree" が要る。depth は 1〜5、from を渡すとそのフォルダから下（省略すると今のフォルダから） */
      getTree(opts?: { depth?: number; from?: EntryRef }): Promise<TreeNode>;
      /** uses に "links" が要る。見つからなければ null */
      resolve(refs: EntryRef[]): Promise<(Entry | null)[]>;

      /** 名前の変更。使えない名前は "invalid"、同じ名前があれば "exists" */
      rename(entry: EntryRef, newName: string): Promise<Entry>;
      /** 今のフォルダにフォルダを作る。name を省略すると「新しいフォルダー」を作り、続けて onAction に { action: "rename" } が届く */
      createFolder(name?: string): Promise<Entry>;
      /** 右クリックのメニューを本体が出す。x・y は MouseEvent の clientX・clientY。extra の項目が選ばれたら chosen にその id */
      showMenu(opts: { x: number; y: number; items: EntryRef[]; extra?: MenuItem[] }): Promise<{ chosen: string | null }>;
      onAction(cb: (a: { action: "rename"; entry: Entry }) => void): () => void;

      /** uses に "tags" が要る */
      readonly tags: {
        list(): Promise<Tag[]>;
        create(name: string, color: string): Promise<Tag>;
        update(id: string, patch: { name?: string; color?: string }): Promise<Tag>;
        delete(id: string): Promise<void>;
        /** on を省略すると true（付ける） */
        assign(entries: EntryRef[], tagId: string, on?: boolean): Promise<void>;
        entries(tagId: string): Promise<Entry[]>;
      };
      onTags(cb: (tags: Tag[]) => void): () => void;

      /** uses に "timetable" が要る。時間割は、このビューが開いているフォルダのもの（学校のフォルダごと） */
      readonly timetable: {
        /** このフォルダに時間割が無ければ null */
        get(): Promise<Timetable | null>;
        /** 本体が検査する。誤りがあれば "invalid"（message に誤りの一覧） */
        set(timetable: Timetable): Promise<Timetable>;
        delete(): Promise<void>;
        current(): Promise<CurrentClass>;
      };
      /** 時間割が変わったとき、フォルダが変わったときに呼ばれる */
      onTimetable(cb: (timetable: Timetable | null) => void): () => void;

      readonly views: { list(): Promise<ViewInfo[]> };
      readonly tabs: {
        /** 新しいタブを開く。replace: true ならこのタブを置き換える。path を省略すると、フォルダと関係するビューでは今のフォルダ */
        open(viewId: string, opts?: { path?: string; replace?: boolean }): Promise<void>;
      };
      /** uses に "quickAccess" が要る */
      readonly quickAccess: {
        list(): Promise<Entry[]>;
        pin(entries: EntryRef[]): Promise<void>;
        unpin(entries: EntryRef[]): Promise<void>;
      };
      onQuickAccess(cb: () => void): () => void;
      /** uses に "recent" が要る（このアプリで開いたファイル、新しい順） */
      readonly recent: { list(): Promise<Entry[]> };
      onRecent(cb: () => void): () => void;

      /** 切り取り・コピー・貼り付け。Windows のエクスプローラと同じ形式なので、エクスプローラとの間でも貼り付けられる */
      readonly clipboard: {
        copy(entries: EntryRef[]): Promise<void>;
        cut(entries: EntryRef[]): Promise<void>;
        /** このビューが開いているフォルダへ貼り付ける */
        paste(): Promise<{ count: number }>;
      };
      /**
       * ドラッグ＆ドロップ。ボタンを押したまま動かし始めたら start を呼ぶ。そこから先は、ランタイムがマウスの動きを本体へ送り、
       * 本体が落とせる場所（targets・アドレスバー・左の欄・タブ）を光らせ、離したら移動・コピーする（Win11 と同じ決まり）
       */
      readonly drag: {
        start(opts: { items: EntryRef[]; x: number; y: number; targets?: { entry: EntryRef; rect: RectLike }[] }): Promise<void>;
        targets(list: { entry: EntryRef; rect: RectLike }[]): Promise<void>;
      };
      /** ドラッグ中にこのビューのタブへ切り替わったとき。drag.targets で落とせる場所を知らせる */
      onDragTargets(cb: () => void): () => void;
    }
  }
}
