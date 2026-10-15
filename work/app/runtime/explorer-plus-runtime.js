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
  const dragTargetListeners = new Set();
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
      } else if (m.event === "changes") {
        for (const cb of changesListeners) safely(cb, m.data);
      } else if (m.event === "mods") {
        for (const cb of modsListeners) safely(cb);
      }
    }
  });

  // ブラウザ本来の右クリックのメニュー（戻る・印刷・開発者ツールなど）は出さない。文字の入力欄だけは、コピー・貼り付けのために残す。
  // MOD が自分の右クリックの動きを付けたいときは、ep.showMenu を使う（ADR 0009 判断2）
  window.addEventListener("contextmenu", (e) => {
    if (!e.target.closest || !e.target.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
  });

  // Ctrl・Alt を押しながらのキーと F5 は、本体のショートカット（タブを開く、読み直す、など）のために本体へも伝える。
  // F5・Ctrl+R はブラウザの「ページの再読み込み」なので止める（止めないと、アプリ全体が読み込み直される）
  window.addEventListener(
    "keydown",
    (e) => {
      const reload = e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"));
      if (reload) e.preventDefault();
      if (!e.ctrlKey && !e.altKey && e.key !== "F5") return;
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
    getTree: (opts) => call("getTree", { depth: (opts && opts.depth) || 1 }),
    resolve: (refs) => call("resolve", { refs: refs.map(toRef) }),
    // ↓ 2026-10-14 に追加（ADR 0009）
    rename: (entry, newName) => call("rename", Object.assign(toRef(entry), { newName })),
    /** name を省略すると「新しいフォルダー」（作った後に onAction で rename が届く）。name を渡すとその名前で作る */
    createFolder: (name) => call("createFolder", name !== undefined ? { name } : {}),
    /** opts: { x, y, items: Entry[], extra?: [{ id, label }] }。x・y はこのページの中の座標（MouseEvent の clientX・clientY） */
    showMenu: (opts) =>
      call("showMenu", Object.assign({ x: opts.x, y: opts.y, items: (opts.items || []).map(toRef) }, opts.extra ? { extra: opts.extra } : {})),
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
    }),
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
