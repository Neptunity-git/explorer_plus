// explorer_plus のランタイム（MOD の API 第1版）。MOD のページに本体が読み込み、window.explorerPlus を作る。
// 約束事：docs/design/mod-api-v1.md。MOD 作者がビルドなしで読めるよう、素の JavaScript で書く。
(() => {
  "use strict";

  let nextId = 1;
  const pending = new Map();
  const folderListeners = new Set();
  const themeListeners = new Set();
  const actionListeners = new Set();
  const tagListeners = new Set();
  const timetableListeners = new Set();
  const quickAccessListeners = new Set();
  const recentListeners = new Set();
  const modsListeners = new Set();
  const changesListeners = new Set();
  const settingsListeners = new Set();
  const collectionsListeners = new Set();
  const commandListeners = new Set();
  const dragTargetListeners = new Set();
  const logsListeners = new Set();
  const folderDataListeners = new Set();
  const menuListeners = new Set();
  // 受け取り口（onMenu）ができる前に届いた知らせ menu。見えない所で動かすときは、MOD のプログラムより先に届くことがある
  const pendingMenu = [];
  let lastFolder = null;
  let lastTimetable = null; // { data: Timetable | null }（null も「時間割なし」として覚えるため、包んで持つ）
  let theme = "light";

  // 見た目をそろえやすいよう、色などを CSS 変数で渡す（MOD は使っても使わなくてもよい）
  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: light;
      --ep-font: "Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif;
      --ep-bg: #ffffff; --ep-fg: #1b1b1b; --ep-muted: #616161; --ep-border: #e5e5e5;
      --ep-hover: #f3f3f3; --ep-selected: #e0eef9; --ep-selected-border: #99c9ef; --ep-accent: #005fb8;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --ep-bg: #202020; --ep-fg: #ffffff; --ep-muted: #a0a0a0; --ep-border: #3a3a3a;
      --ep-hover: #2d2d2d; --ep-selected: #1f3a52; --ep-selected-border: #3e6d93; --ep-accent: #60cdff;
    }
    html, body { background: var(--ep-bg); color: var(--ep-fg); font-family: var(--ep-font); }
  `;
  document.head.prepend(style);

  function setTheme(t) {
    theme = t === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  }

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parent.postMessage({ ep: 1, kind: "call", id, method, params: params || {} }, "*");
    });
  }

  function safely(cb, arg) {
    try {
      cb(arg);
    } catch (e) {
      console.error("[explorerPlus] listener failed:", e);
    }
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== parent) return;
    const m = ev.data;
    if (!m || m.ep !== 1) return;
    if (m.kind === "result") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) {
        p.resolve(m.value);
      } else {
        const err = new Error((m.error && m.error.message) || "explorerPlus call failed");
        err.code = (m.error && m.error.code) || "io";
        p.reject(err);
      }
    } else if (m.kind === "event") {
      if (m.event === "folder") {
        lastFolder = m.data;
        for (const cb of folderListeners) safely(cb, m.data);
      } else if (m.event === "theme") {
        setTheme(m.data);
        for (const cb of themeListeners) safely(cb, theme);
      } else if (m.event === "action") {
        for (const cb of actionListeners) safely(cb, m.data);
      } else if (m.event === "tags") {
        for (const cb of tagListeners) safely(cb, m.data);
      } else if (m.event === "timetable") {
        lastTimetable = { data: m.data };
        for (const cb of timetableListeners) safely(cb, m.data);
      } else if (m.event === "quickAccess") {
        for (const cb of quickAccessListeners) safely(cb);
      } else if (m.event === "recent") {
        for (const cb of recentListeners) safely(cb);
      } else if (m.event === "dragTargets") {
        for (const cb of dragTargetListeners) safely(cb);
      } else if (m.event === "collections") {
        for (const cb of collectionsListeners) safely(cb, m.data);
      } else if (m.event === "settings") {
        for (const cb of settingsListeners) safely(cb, m.data);
      } else if (m.event === "command") {
        for (const cb of commandListeners) safely(cb, m.data.id);
      } else if (m.event === "changes") {
        for (const cb of changesListeners) safely(cb, m.data);
      } else if (m.event === "mods") {
        for (const cb of modsListeners) safely(cb);
      } else if (m.event === "folderData") {
        for (const cb of folderDataListeners) safely(cb, m.data);
      } else if (m.event === "logs") {
        for (const cb of logsListeners) safely(cb, m.data);
      } else if (m.event === "menu") {
        if (menuListeners.size === 0) pendingMenu.push(m.data);
        for (const cb of menuListeners) safely(cb, m.data);
      } else if (m.event === "releasePointer") {
        releasePointer();
      }
    }
  });

  // ---- console.log・エラーを、本体の「MOD ごとのログ」にも送る（ADR 0029。ホームのログの欄で見られる） ----
  // 開発者ツールのコンソールにも、これまでどおり出る
  function describe(v) {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    if (v === undefined) return "undefined";
    if (typeof v === "function") return `[function ${v.name || ""}]`;
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s.length > 2000 ? s.slice(0, 2000) + "…" : s;
    } catch (_) {
      return String(v);
    }
  }
  function sendLog(level, args) {
    try {
      parent.postMessage({ ep: 1, kind: "log", level, text: Array.from(args, describe).join(" ").slice(0, 4000) }, "*");
    } catch (_) {
      // 送れなくても、MOD の動きは止めない
    }
  }
  for (const [name, level] of [["log", "info"], ["info", "info"], ["debug", "info"], ["warn", "warn"], ["error", "error"]]) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      original(...args);
      sendLog(level, args);
    };
  }
  window.addEventListener("error", (e) => sendLog("error", [`${e.message}${e.filename ? ` (${String(e.filename).split("/").pop()}:${e.lineno})` : ""}`]));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    // 本体が断った（ep.* の失敗）ものは、本体がログに残すので、ここでは「受け取らなかった」とだけ書く
    sendLog("error", [`Uncaught (in promise) ${r && r.code ? `${r.code}: ${r.message}` : describe(r)}`]);
  });

  /** WebView2 が自分で処理してしまうキー：Ctrl+P・Ctrl+Shift+P（印刷）、Ctrl+F・F3・Ctrl+G（ページ内検索）、Ctrl+S（保存）、Ctrl+U・Ctrl+J・Ctrl+H */
  const BROWSER_KEY = (e) =>
    e.key === "F3" || (e.ctrlKey && !e.altKey && ["p", "f", "g", "s", "u", "j", "h"].includes(e.key.length === 1 ? e.key.toLowerCase() : ""));

  // ブラウザ本来の右クリックのメニュー（戻る・印刷・開発者ツールなど）は出さない。文字の入力欄だけは、コピー・貼り付けのために残す。
  // MOD が自分の右クリックの動きを付けたいときは、ep.showMenu を使う（ADR 0009 判断2）
  window.addEventListener("contextmenu", (e) => {
    if (!e.target.closest || !e.target.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
  });

  // ---- ポインターロック（uses に "pointerLock"。ADR 0039） ----
  // ロックは MOD が標準の requestPointerLock() で自分でする。ロック中はポインターが消えて動かせないので、本体の画面
  // （確かめ・メニュー・ほかのタブ）に手が届かなくなる。そうなる前に、自分で外す（Esc でも、いつでも外れる）
  const releasePointer = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  // 本体の別の場所にフォーカスが移った・ページが隠れた
  window.addEventListener("blur", releasePointer);
  document.addEventListener("visibilitychange", () => document.hidden && releasePointer());

  // Ctrl・Alt を押しながらのキーと F5 は、本体のショートカット（タブを開く、読み直す、など）のために本体へも伝える。
  // F5・Ctrl+R はブラウザの「ページの再読み込み」なので止める（止めないと、アプリ全体が読み込み直される）
  window.addEventListener(
    "keydown",
    (e) => {
      const reload = e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"));
      if (reload) e.preventDefault();
      // WebView2 自身のショートカット（印刷・ページ内検索・ページの保存など）は止める。MOD 自身のキーの処理はそのまま動く
      if (BROWSER_KEY(e)) e.preventDefault();
      if (!e.ctrlKey && !e.altKey && e.key !== "F5") return;
      // ポインターロック中は、本体のショートカットを効かせない。Ctrl を押しながら W で走る、のような遊び方で、
      // タブが閉じたりしないように（ADR 0039）。上の「ブラウザ自身のショートカットを止める」は、ロック中も効かせたまま
      if (document.pointerLockElement) return;
      parent.postMessage({ ep: 1, kind: "key", key: reload ? "F5" : e.key, ctrl: reload ? false : e.ctrlKey, shift: e.shiftKey, alt: e.altKey }, "*");
    },
    true,
  );

  const toRef = (e) => ({ id: e.id, path: e.path });
  const toRect = (r) => ({ x: r.x !== undefined ? r.x : r.left, y: r.y !== undefined ? r.y : r.top, width: r.width, height: r.height });
  const withFrom = (params, opts) => (opts && opts.from ? Object.assign(params, { from: toRect(opts.from) }) : params);

  // 読み込まれたらすぐ本体へ「準備できた」と伝える。本体はその返事の後に、今のフォルダを送ってくる
  const ready = call("ready").then((ctx) => {
    setTheme(ctx.theme);
    return ctx;
  });

  // ---- net.fetch（ADR 0027）の引数と結果 ----
  function netParams(url, opts) {
    const o = opts || {};
    let headers = [];
    if (o.headers instanceof Headers) headers = Array.from(o.headers.entries());
    else if (Array.isArray(o.headers)) headers = o.headers.map((h) => [String(h[0]), String(h[1])]);
    else if (o.headers) headers = Object.entries(o.headers).map(([k, v]) => [k, String(v)]);
    let body = o.body;
    if (o.json !== undefined) {
      body = JSON.stringify(o.json);
      if (!headers.some((h) => h[0].toLowerCase() === "content-type")) headers.push(["Content-Type", "application/json"]);
    }
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    else if (ArrayBuffer.isView(body) && !(body instanceof Uint8Array)) body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return Object.assign(
      { url: String(url), method: o.method ? String(o.method).toUpperCase() : "GET", headers },
      body !== undefined && body !== null ? { body } : {},
      o.secret ? { secret: o.secret } : {},
    );
  }

  function netResponse(r) {
    const headers = new Headers(r.headers);
    const bytes = r.body;
    const text = () => {
      const m = /charset=["']?([^;"']+)/i.exec(headers.get("content-type") || "");
      try {
        return new TextDecoder(m ? m[1].trim() : "utf-8").decode(bytes);
      } catch (_) {
        return new TextDecoder().decode(bytes);
      }
    };
    return Object.freeze({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText,
      url: r.url,
      headers,
      text: async () => text(),
      json: async () => JSON.parse(text()),
      bytes: async () => bytes,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      blob: async () => new Blob([bytes], { type: headers.get("content-type") || "" }),
    });
  }

  window.explorerPlus = Object.freeze({
    apiVersion: 1,
    ready: () => ready,
    onFolder(cb) {
      folderListeners.add(cb);
      if (lastFolder) {
        const snapshot = lastFolder;
        queueMicrotask(() => folderListeners.has(cb) && safely(cb, snapshot));
      }
      return () => folderListeners.delete(cb);
    },
    onTheme(cb) {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    get theme() {
      return theme;
    },
    /** opts: { from?: 画面上の位置, newTab?: true（フォルダを新しいタブで開く。2026-10-14 に追加） } */
    open: (entry, opts) =>
      call("open", Object.assign(withFrom(toRef(entry), opts), opts && opts.newTab ? { newTab: true } : {})).then(() => undefined),
    navigate: (path) => call("navigate", { path }).then(() => undefined),
    navigateUp: () => call("navigateUp").then(() => undefined),
    trash: (entries, opts) => call("trash", withFrom({ items: entries.map(toRef) }, opts)),
    storage: Object.freeze({
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }).then(() => undefined),
      delete: (key) => call("storage.delete", { key }).then(() => undefined),
      keys: () => call("storage.keys"),
    }),
    getTree: (opts) => call("getTree", { depth: (opts && opts.depth) || 1, ...(opts && opts.from ? { from: { id: opts.from.id, path: opts.from.path } } : {}) }),
    resolve: (refs) => call("resolve", { refs: refs.map(toRef) }),
    // ↓ 2026-10-14 に追加（ADR 0009）
    rename: (entry, newName) => call("rename", Object.assign(toRef(entry), { newName })),
    /** name を省略すると「新しいフォルダー」（作った後に onAction で rename が届く）。name を渡すとその名前で作る */
    createFolder: (name) => call("createFolder", name !== undefined ? { name } : {}),
    /** opts: { x, y, items: Entry[], extra?: [{ id, label }] }。x・y はこのページの中の座標（MouseEvent の clientX・clientY） */
    showMenu: (opts) =>
      call("showMenu", Object.assign({ x: opts.x, y: opts.y, items: (opts.items || []).map(toRef) }, opts.extra ? { extra: opts.extra } : {})),
    // ↓ 2026-10-22 に追加（ADR 0036）。manifest の menu の項目が、右クリックのメニュー（ほかのビューのものも）で選ばれた
    /** cb({ id, items: Entry[], folder: { id, path } | null })。受け取り口を作る前に届いていた分も渡す */
    onMenu(cb) {
      menuListeners.add(cb);
      const queued = pendingMenu.splice(0);
      if (queued.length > 0) queueMicrotask(() => queued.forEach((data) => menuListeners.has(cb) && safely(cb, data)));
      return () => menuListeners.delete(cb);
    },
    menu: Object.freeze({
      /** 見えない所で動いているとき（ep.ready() の background が true）、終わったことを伝える。本体が止める */
      done: () => call("menu.done").then(() => undefined),
    }),
    /** 本体からの頼みごと（{ action: "rename", entry }）を受け取る */
    onAction(cb) {
      actionListeners.add(cb);
      return () => actionListeners.delete(cb);
    },
    // ↓ 2026-10-14 に追加（タグと時間割。ADR 0010。manifest の uses に "tags"・"timetable" が要る）
    tags: Object.freeze({
      list: () => call("tags.list"),
      create: (name, color) => call("tags.create", { name, color }),
      update: (id, patch) => call("tags.update", Object.assign({ id }, patch)),
      delete: (id) => call("tags.delete", { id }).then(() => undefined),
      assign: (entries, tagId, on) => call("tags.assign", { items: entries.map(toRef), tagId, on: on !== false }).then(() => undefined),
      entries: (tagId) => call("tags.entries", { tagId }),
    }),
    onTags(cb) {
      tagListeners.add(cb);
      return () => tagListeners.delete(cb);
    },
    /** 時間割は、このビューが開いているフォルダのもの（ADR 0012） */
    timetable: Object.freeze({
      get: () => call("timetable.get"),
      set: (timetable) => call("timetable.set", { timetable }),
      delete: () => call("timetable.delete").then(() => undefined),
      current: () => call("timetable.current"),
    }),
    /** 時間割が変わったとき、フォルダが変わったときに呼ばれる（無ければ null） */
    onTimetable(cb) {
      timetableListeners.add(cb);
      // 受け取り口を用意する前に届いていた分も渡す（MOD が import などで遅れて登録しても取りこぼさない。onFolder と同じ）
      if (lastTimetable) {
        const snapshot = lastTimetable.data;
        queueMicrotask(() => timetableListeners.has(cb) && safely(cb, snapshot));
      }
      return () => timetableListeners.delete(cb);
    },
    // ↓ 2026-10-14 に追加（ホーム・クイックアクセス。ADR 0014）
    views: Object.freeze({
      list: () => call("views.list"),
    }),
    tabs: Object.freeze({
      /** opts: { path?, replace?: true（このタブを置き換える） } */
      open: (viewId, opts) =>
        call("tabs.open", Object.assign({ viewId }, opts && opts.path ? { path: opts.path } : {}, opts && opts.replace ? { replace: true } : {})).then(() => undefined),
    }),
    quickAccess: Object.freeze({
      list: () => call("quickAccess.list"),
      pin: (entries) => call("quickAccess.pin", { items: entries.map(toRef) }).then(() => undefined),
      unpin: (entries) => call("quickAccess.unpin", { items: entries.map(toRef) }).then(() => undefined),
    }),
    onQuickAccess(cb) {
      quickAccessListeners.add(cb);
      return () => quickAccessListeners.delete(cb);
    },
    recent: Object.freeze({
      list: () => call("recent.list"),
    }),
    // ↓ 2026-10-15 に追加（フォルダの中に置くデータ。ADR 0022）。uses に "folderData" が要る。
    // フォルダについてのデータを、そのフォルダの中（.explorer_plus）に保存する。OneDrive などで同期すれば別の PC でも出る。
    // folder は onFolder で届いたフォルダ（{ id, path } があればよい）
    folderData: Object.freeze({
      get: (folder) => call("folderData.get", { folder: toRef(folder) }),
      set: (folder, value) => call("folderData.set", { folder: toRef(folder), value }).then(() => undefined),
      delete: (folder) => call("folderData.delete", { folder: toRef(folder) }).then(() => undefined),
    }),
    /** 開いているフォルダのこのビューのデータを、ほかのウィンドウ（同じビューで同じフォルダを開いている）が書き換えた。folderData.get で読み直す（ADR 0030） */
    onFolderData(cb) {
      folderDataListeners.add(cb);
      return () => folderDataListeners.delete(cb);
    },
    // ↓ 2026-10-15 に追加（読み取りの API。ADR 0023）
    // uses に "fileContent"：ファイルの中身。readText は文字コード（UTF-8・UTF-16・Shift_JIS）を見分ける
    files: Object.freeze({
      readText: (entry, opts) =>
        call("files.readText", Object.assign({ item: toRef(entry) }, opts && opts.offset !== undefined ? { offset: opts.offset } : {}, opts && opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {})),
      readBytes: (entry, opts) =>
        call("files.readBytes", Object.assign({ item: toRef(entry) }, opts && opts.offset !== undefined ? { offset: opts.offset } : {}, opts && opts.length !== undefined ? { length: opts.length } : {})),
      /** <img>・<video>・<audio>・fetch にそのまま使える URL（動画のシークもできる） */
      url: (entry) => call("files.url", { item: toRef(entry) }),
      // uses に "fileInfo"：撮影日時・曲名・動画の長さなど
      info: (entries) => call("files.info", { items: entries.map(toRef) }),
      properties: (entries, names) => call("files.properties", { items: entries.map(toRef), names }),
      // uses に "createFiles"（ADR 0025）：新しく作るだけ（同じ名前があれば "exists"）。最初に使うとき、本体が許可を聞く
      create: (folder, name, opts) =>
        call(
          "files.create",
          Object.assign(
            { folder: toRef(folder), name, kind: (opts && opts.kind) || "file" },
            opts && opts.text !== undefined ? { text: opts.text } : {},
            opts && opts.bytes !== undefined ? { bytes: opts.bytes } : {},
          ),
        ),
      createShortcut: (folder, target, opts) => call("files.createShortcut", Object.assign({ folder: toRef(folder), target: toRef(target) }, opts && opts.name ? { name: opts.name } : {})),
    }),
    // uses に "search"：下の階層までの検索と集計
    search: Object.freeze({
      find: (folder, query, opts) =>
        call(
          "search.find",
          Object.assign({ folder: toRef(folder), query: query || {} }, opts && opts.depth !== undefined ? { depth: opts.depth } : {}, opts && opts.limit !== undefined ? { limit: opts.limit } : {}),
        ),
      stats: (folder, opts) => call("search.stats", Object.assign({ folder: toRef(folder) }, opts && opts.depth !== undefined ? { depth: opts.depth } : {})),
    }),
    // uses に "system"：ドライブと空き容量・強調色・言語
    system: Object.freeze({
      drives: () => call("system.drives"),
      info: () => call("system.info"),
    }),
    /** 開いているフォルダの直下で起きた変化（作られた・消えた・名前が変わった・書き換わった）。uses に "entries" が要る */
    onChanges(cb) {
      changesListeners.add(cb);
      return () => changesListeners.delete(cb);
    },
    // ↓ 2026-10-15 に追加（本体の画面を使う。ADR 0024）。uses の宣言は要らない
    ui: Object.freeze({
      /** 画面の下に短いお知らせ（表示中のタブのビューだけ） */
      toast: (text) => call("ui.toast", { text: String(text) }).then(() => undefined),
      /** 画面の下の状態の欄（null で消す） */
      status: (text) => call("ui.status", { text: text === null || text === undefined ? null : String(text) }).then(() => undefined),
      /** タブの名前・バッジ（null で元に戻す・消す） */
      tab: (opts) => call("ui.tab", opts || {}).then(() => undefined),
      /** 本体の確かめ・入力・選択の画面（表示中のタブのビューだけ。同時に1つ） */
      confirm: (message, opts) => call("ui.confirm", Object.assign({ message }, opts && opts.okLabel ? { okLabel: opts.okLabel } : {})),
      ask: (opts) => call("ui.ask", opts),
      choose: (items, opts) => call("ui.choose", Object.assign({ items }, opts && opts.title ? { title: opts.title } : {})),
    }),
    // ↓ 2026-10-15 に追加（本体が代わりに通信する。ADR 0027）。manifest の network に書いた先だけ
    net: Object.freeze({
      /** fetch に似た形。ブラウザの決まり（CORS）を受けず、「explorer_plus の、この MOD から」と名乗って通信する */
      fetch: (url, opts) => call("net.fetch", netParams(url, opts)).then(netResponse),
      /** <img>・<audio>・CSS などにそのまま使える URL（本体が代わりに取ってくる） */
      url: (url, opts) => call("net.url", Object.assign({ url: String(url) }, opts && opts.secret ? { secret: opts.secret } : {})),
    }),
    // uses に "collections"（ADR 0025）：コレクション（仮想ディレクトリ）
    collections: Object.freeze({
      list: () => call("collections.list"),
      create: (name, opts) => call("collections.create", Object.assign({ name }, opts && opts.color ? { color: opts.color } : {})),
      update: (id, patch) => call("collections.update", Object.assign({ id }, patch || {})),
      delete: (id) => call("collections.delete", { id }).then(() => undefined),
      add: (id, entries) => call("collections.add", { id, items: entries.map(toRef) }).then(() => undefined),
      remove: (id, entries) => call("collections.remove", { id, items: entries.map(toRef) }).then(() => undefined),
      entries: (id) => call("collections.entries", { id }),
    }),
    onCollections(cb) {
      collectionsListeners.add(cb);
      return () => collectionsListeners.delete(cb);
    },
    /** manifest の settings の値。設定の画面で変わると onSettings が呼ばれる */
    settings: Object.freeze({
      get: () => call("settings.get"),
    }),
    onSettings(cb) {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    /** コマンドの一覧（Ctrl+Shift+P）に出すコマンド。選ばれると onCommand に id が届く */
    commands: Object.freeze({
      set: (list) => call("commands.set", { commands: list }).then(() => undefined),
    }),
    onCommand(cb) {
      commandListeners.add(cb);
      return () => commandListeners.delete(cb);
    },
    // ↓ 2026-10-15 に追加（MOD の管理。ADR 0020）。標準のビュー（ホーム）だけが使える。ほかの MOD が呼ぶと code "denied" で失敗する
    mods: Object.freeze({
      list: () => call("mods.list"),
      install: () => call("mods.install").then((r) => r.id),
      remove: (id) => call("mods.remove", { id }).then(() => undefined),
      addDev: () => call("mods.addDev").then((r) => r.dir),
      createDev: (name) => call("mods.createDev", { name }).then((r) => r.dir),
      pack: (id) => call("mods.pack", { id }).then((r) => r.path),
      openFolder: (id) => call("mods.openFolder", { id }).then(() => undefined),
      openDocs: () => call("mods.openDocs").then(() => undefined),
      openDevtools: () => call("mods.openDevtools").then(() => undefined),
      openSettings: (id) => call("mods.openSettings", { id }).then(() => undefined),
    }),
    // ↓ 2026-10-15 に追加（ログ。ADR 0029）。標準のビューだけが使える
    logs: Object.freeze({
      list: (source) => call("logs.list", { source }),
      sources: () => call("logs.sources"),
      clear: (source) => call("logs.clear", { source }).then(() => undefined),
      // ↓ 2026-10-22 に追加（ADR 0038）
      openFile: (source, level) => call("logs.openFile", { source, ...(level ? { level } : {}) }).then(() => undefined),
      openFolder: () => call("logs.openFolder").then(() => undefined),
    }),
    onLogs(cb) {
      logsListeners.add(cb);
      return () => logsListeners.delete(cb);
    },
    onMods(cb) {
      modsListeners.add(cb);
      return () => modsListeners.delete(cb);
    },
    onRecent(cb) {
      recentListeners.add(cb);
      return () => recentListeners.delete(cb);
    },
    // ↓ 2026-10-14 に追加（切り取り・コピー・貼り付け、ドラッグ＆ドロップ。ADR 0015）
    clipboard: Object.freeze({
      copy: (entries) => call("clipboard.copy", { items: entries.map(toRef) }).then(() => undefined),
      cut: (entries) => call("clipboard.cut", { items: entries.map(toRef) }).then(() => undefined),
      /** このビューが開いているフォルダへ貼り付ける。{ count } が返る */
      paste: () => call("clipboard.paste"),
    }),
    drag: Object.freeze({
      /**
       * ドラッグを始める（マウスのボタンを押したまま動かし始めたときに呼ぶ）。
       * opts: { items: Entry[], x, y（MouseEvent の clientX・clientY）, targets?: [{ entry, rect }]（このビューの中の、落とせるフォルダと、その位置） }
       * あとはランタイムがマウスの動きを本体へ送り、離したところで本体が移動・コピーする
       */
      start(opts) {
        const targets = toTargets(opts.targets || []);
        return call("drag.start", { items: opts.items.map(toRef), x: opts.x, y: opts.y, targets }).then(() => followDrag());
      },
      /** 落とせる場所を知らせ直す（onDragTargets で頼まれたとき） */
      targets: (list) => call("drag.targets", { targets: toTargets(list) }).then(() => undefined),
    }),
    /** ドラッグ中にこのビューのタブへ切り替わったときに呼ばれる。ep.drag.targets(…) で落とせる場所を知らせる */
    onDragTargets(cb) {
      dragTargetListeners.add(cb);
      return () => dragTargetListeners.delete(cb);
    },
  });

  // ---- ドラッグの間、マウスの動きを本体へ送る（iframe の中で押したボタンの動きは、離すまでこの iframe に届くため） ----

  function toTargets(list) {
    return list.map((t) => {
      const r = t.rect;
      return { id: t.entry.id, path: t.entry.path, x: r.x !== undefined ? r.x : r.left, y: r.y !== undefined ? r.y : r.top, width: r.width, height: r.height };
    });
  }

  let lastPointerId = null;
  window.addEventListener("pointerdown", (e) => (lastPointerId = e.pointerId), true);
  // ブラウザ本来のドラッグ（画像や文字をつかんで動かす）は止める。始まると、ボタンを離したことが届かなくなり、
  // 本体のドラッグ＆ドロップ（ep.drag）が終わらなくなる。文字の入力欄の中だけは残す
  window.addEventListener("dragstart", (e) => {
    if (!e.target.closest || !e.target.closest("input, textarea")) e.preventDefault();
  });

  function followDrag() {
    let pending = null;
    let frame = 0;
    const send = () => {
      frame = 0;
      if (pending) call("drag.move", pending);
      pending = null;
    };
    const onMove = (e) => {
      pending = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey, shift: e.shiftKey };
      if (!frame) frame = requestAnimationFrame(send);
    };
    const finish = (e, cancel) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      if (frame) cancelAnimationFrame(frame);
      call("drag.end", { x: e.clientX || 0, y: e.clientY || 0, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, cancel });
    };
    const onUp = (e) => finish(e, false);
    // 何かの理由でポインタの追いかけが途切れたら、やめたことにする（ドラッグが終わらないままにしない）
    const onCancel = (e) => finish(e, true);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(e, true);
      }
    };
    // iframe の外へマウスが出ても動きを受け取れるように、押しているポインタをこのページで捕まえる
    try {
      if (lastPointerId !== null) document.documentElement.setPointerCapture(lastPointerId);
    } catch {
      // 捕まえられなくても、多くの場合は届く
    }
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
  }
})();
