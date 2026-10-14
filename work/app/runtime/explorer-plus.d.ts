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

    type ErrorCode = "not-declared" | "denied" | "not-found" | "too-large" | "invalid" | "io" | "exists";

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

      /** uses に "tree" が要る */
      getTree(opts?: { depth?: number }): Promise<TreeNode>;
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
