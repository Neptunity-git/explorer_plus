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
  let lastFolder = null;
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
        for (const cb of timetableListeners) safely(cb, m.data);
      }
    }
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
    createFolder: () => call("createFolder"),
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
    timetable: Object.freeze({
      get: () => call("timetable.get"),
      set: (timetable) => call("timetable.set", { timetable }),
      current: () => call("timetable.current"),
    }),
    onTimetable(cb) {
      timetableListeners.add(cb);
      return () => timetableListeners.delete(cb);
    },
  });
})();
