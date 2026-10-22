// @ts-check
// 樹形図ビュー（ADR 0032）：今のフォルダを根にして、左から右へ枝分かれする図を描く。
// 枝は ▸ を押したときに、その下を1段だけ読む（getTree の from）。開いた枝はフォルダごとに覚える。

export {}; // ES モジュール（一番外で await を使う）

const ep = window.explorerPlus;

const sheets = ["/__runtime/tui.css", "./style.css"].map((href) => Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
document.head.append(...sheets);
// 文字の幅は CSS の字体で測るので、読み込みを待ってから描く
const sheetsLoaded = Promise.all(sheets.map((l) => new Promise((done) => { l.onload = l.onerror = done; })));
document.body.className = "tui";
document.body.innerHTML = `
  <div class="tui-toolbar">
    <button class="tui-button" id="up">↑ 上へ</button>
    <button class="tui-button" id="files">ファイルも出す</button>
    <button class="tui-button" id="collapse">全部たたむ</button>
    <button class="tui-button" id="home">根へ戻る</button>
    <button class="tui-button" id="reload">読み直す</button>
    <span class="zoom" id="zoom">100%</span>
  </div>
  <div id="stage" tabindex="0"><svg><g id="world"></g></svg></div>
  <div class="tui-footer">
    <span><span class="tui-key">▸</span>枝を開く・たたむ</span>
    <span><span class="tui-key">ダブルクリック</span>開く</span>
    <span><span class="tui-key">右クリック</span>メニュー</span>
    <span><span class="tui-key">ドラッグ・ホイール</span>動かす</span>
    <span><span class="tui-key">Ctrl+ホイール</span>拡大・縮小</span>
  </div>`;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const $stage = $("stage");
const $world = $("world");
const $files = $("files");
const $zoom = $("zoom");

// ---- 寸法 ----
const ROW = 34; // 葉（開いていない枝）1つぶんの高さ
const BOX_H = 24;
const GAP_X = 56; // 列と列のあいだ
const PAD = 8; // 箱の中の左右の余白
const ICON = 16;
const TOGGLE_R = 8;
const NAME_MAX = 30; // これより長い名前は … で切る
const CHILD_PAGE = 200; // 1つの枝に一度に出す数。超えたら「… あと n 個」
const OPEN_ROOTS_MAX = 50; // 開いた枝を覚えておくフォルダの数

/**
 * 図の1つの節。children が null なら、まだ読んでいない
 * @typedef {{ entry: ExplorerPlus.Entry, children: TNode[] | null, open: boolean, loading: boolean, limit: number }} TNode
 * 描くときに使う、並べた結果
 * @typedef {{ key: string, node: TNode | null, more: { parent: TNode, rest: number } | null, depth: number, x: number, y: number, w: number, label: string, count: string, parent: Placed | null }} Placed
 */

/** @type {TNode | null} */
let root = null;
let showFiles = false;
let initialDepth = 2;
/** @type {string | null} */
let selected = null;
let view = { tx: 24, ty: 0, k: 1 };
/** @type {Placed[]} */
let placed = [];
/** 前回描いた節（新しく出た節だけ、ふわっと出す） */
let drawnKeys = new Set();
/** フォルダ（ID かパス）→ 開いている枝のパス。新しく使ったものが後ろ */
/** @type {Record<string, string[]>} */
let openMemory = {};
let loadSeq = 0;

// ---- 文字の幅を測る ----
const measureCtx = /** @type {CanvasRenderingContext2D} */ (document.createElement("canvas").getContext("2d"));
function textWidth(/** @type {string} */ text, size = 13) {
  measureCtx.font = `${size}px ${getComputedStyle(document.body).getPropertyValue("--tui-font") || "monospace"}`;
  return measureCtx.measureText(text).width;
}
function shorten(/** @type {string} */ name) {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

// ---- 節を作る・読む ----

/** @param {ExplorerPlus.TreeNode} t */
function fromTree(t) {
  /** @type {TNode} */
  const node = { entry: t.entry, children: null, open: false, loading: false, limit: CHILD_PAGE };
  if (t.children) {
    node.children = t.children.map(fromTree);
    node.open = true;
  }
  return node;
}

function rootKey() {
  return root ? root.entry.id || root.entry.path : "";
}

/** 見せる子（ファイルを隠しているときはフォルダだけ） */
function visibleChildren(/** @type {TNode} */ node) {
  const kids = node.children ?? [];
  return showFiles ? kids : kids.filter((c) => c.entry.kind === "folder");
}

/** その下を1段読む */
async function loadChildren(/** @type {TNode} */ node, depth = 1) {
  node.loading = true;
  render();
  try {
    const t = await ep.getTree({ depth, from: node.entry });
    node.children = fromTree(t).children ?? [];
    if (depth > 1) openAll(node);
  } catch (e) {
    node.children = [];
    void ep.ui.toast(`読めませんでした：${node.entry.name}`);
    console.warn("getTree", node.entry.path, e);
  }
  node.loading = false;
}

function openAll(/** @type {TNode} */ node) {
  for (const c of node.children ?? []) {
    if (c.children) {
      c.open = true;
      openAll(c);
    }
  }
}

/** @param {(n: TNode) => void} fn */
function walk(/** @type {TNode} */ node, fn) {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

function findNode(/** @type {string} */ path) {
  /** @type {TNode | null} */
  let found = null;
  if (root) walk(root, (n) => { if (n.entry.path === path) found = n; });
  return found;
}

// ---- 開いた枝を覚える（ep.storage） ----

function saveOpen() {
  if (!root) return;
  /** @type {string[]} */
  const paths = [];
  walk(root, (n) => { if (n !== root && n.open) paths.push(n.entry.path); });
  const key = rootKey();
  delete openMemory[key];
  openMemory[key] = paths.slice(0, 500);
  const keys = Object.keys(openMemory);
  for (const k of keys.slice(0, Math.max(0, keys.length - OPEN_ROOTS_MAX))) delete openMemory[k];
  void ep.storage.set("open", openMemory).catch((e) => console.warn("storage", e));
}

/** 覚えていた枝を開き直す。まだ読んでいない枝は、浅いものから順に読む */
async function restoreOpen(/** @type {number} */ seq) {
  const saved = openMemory[rootKey()];
  if (!saved || !root) return;
  const want = new Set(saved);
  walk(root, (n) => { if (n !== root) n.open = n.children !== null && want.has(n.entry.path); });
  for (let round = 0; round < 8; round++) {
    /** @type {TNode[]} */
    const todo = [];
    const visit = (/** @type {TNode} */ n) => {
      for (const c of n.children ?? []) {
        if (!want.has(c.entry.path)) continue;
        if (c.children === null) todo.push(c);
        else visit(c);
      }
    };
    visit(root);
    if (todo.length === 0) return;
    for (const n of todo.slice(0, 30)) {
      await loadChildren(n);
      if (seq !== loadSeq) return; // 途中で別のフォルダへ移った
      n.open = true;
    }
    render();
  }
}

// ---- 並べる（左から右へ。葉を上から順に置き、親は子の真ん中） ----

function layout() {
  /** @type {Placed[]} */
  const out = [];
  /** @type {number[]} */
  const colW = [];
  let leafY = 0;

  /** @returns {Placed} */
  const visit = (/** @type {TNode} */ node, /** @type {number} */ depth, /** @type {Placed | null} */ parent) => {
    const e = node.entry;
    const label = shorten(e.name);
    const files = node.children && !showFiles ? node.children.filter((c) => c.entry.kind === "file").length : 0;
    const count = files > 0 ? `ファイル ${files}` : "";
    let w = PAD + ICON + 6 + textWidth(label) + PAD;
    if (count) w += textWidth(count, 11) + 8;
    if (e.kind === "folder") w += TOGGLE_R; // 右の縁に ▸ が半分かかる
    /** @type {Placed} */
    const p = { key: e.path, node, more: null, depth, x: 0, y: 0, w, label, count, parent };
    out.push(p);
    colW[depth] = Math.max(colW[depth] ?? 0, w);

    const kids = node.open ? visibleChildren(node) : [];
    if (kids.length === 0) {
      p.y = leafY;
      leafY += ROW;
      return p;
    }
    const shown = kids.slice(0, node.limit);
    const placedKids = shown.map((c) => visit(c, depth + 1, p));
    if (kids.length > shown.length) {
      const label = `… あと ${kids.length - shown.length} 個`;
      const mw = PAD + textWidth(label) + PAD;
      /** @type {Placed} */
      const m = { key: `${e.path}\u0000more`, node: null, more: { parent: node, rest: kids.length - shown.length }, depth: depth + 1, x: 0, y: leafY, w: mw, label, count: "", parent: p };
      leafY += ROW;
      out.push(m);
      placedKids.push(m);
      colW[depth + 1] = Math.max(colW[depth + 1] ?? 0, mw);
    }
    p.y = (placedKids[0].y + placedKids[placedKids.length - 1].y) / 2;
    return p;
  };
  if (root) visit(root, 0, null);

  /** @type {number[]} */
  const colX = [];
  let x = 0;
  for (let d = 0; d < colW.length; d++) {
    colX[d] = x;
    x += colW[d] + GAP_X;
  }
  for (const p of out) p.x = colX[p.depth];
  return out;
}

// ---- 描く ----

const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function render() {
  placed = layout();
  let edges = "";
  let nodes = "";
  const half = BOX_H / 2;
  placed.forEach((p, i) => {
    if (p.parent) {
      const x1 = p.parent.x + p.parent.w;
      const y1 = p.parent.y;
      const x2 = p.x;
      const mid = (x1 + x2) / 2;
      edges += `<path class="edge" d="M${x1},${y1} C${mid},${y1} ${mid},${p.y} ${x2},${p.y}"/>`;
    }
    const n = p.node;
    const cls = ["node"];
    if (!drawnKeys.has(p.key) && drawnKeys.size > 0) cls.push("is-new");
    if (p.more) cls.push("is-more");
    if (n === root) cls.push("is-root");
    if (n && n.entry.hidden) cls.push("is-hidden");
    if (p.key === selected) cls.push("is-selected");
    let inner = `<rect class="node-box" x="0" y="${-half}" width="${p.w}" height="${BOX_H}" rx="4"/>`;
    let tx = PAD;
    if (n) {
      if (n.entry.iconUrl) inner += `<image href="${esc(n.entry.iconUrl)}" x="${PAD}" y="${-ICON / 2}" width="${ICON}" height="${ICON}"/>`;
      tx = PAD + ICON + 6;
    }
    inner += `<text x="${tx}" y="0">${esc(p.label)}</text>`;
    if (p.count) inner += `<text class="count" x="${tx + textWidth(p.label) + 8}" y="0">${esc(p.count)}</text>`;
    if (n && n.entry.kind === "folder" && n !== root) {
      const mark = n.loading ? "…" : n.open && n.children ? "◂" : "▸";
      inner += `<g class="toggle" data-toggle="${i}"><circle cx="${p.w}" cy="0" r="${TOGGLE_R}"/><text x="${p.w}" y="0">${mark}</text></g>`;
    }
    nodes += `<g class="${cls.join(" ")}" data-i="${i}" transform="translate(${p.x},${p.y})">${inner}</g>`;
  });
  $world.innerHTML = edges + nodes;
  drawnKeys = new Set(placed.map((p) => p.key));
  applyView();
  $files.classList.toggle("is-accent", showFiles);
  const folders = placed.filter((p) => p.node && p.node.entry.kind === "folder").length;
  void ep.ui.status(`樹形図：${folders} フォルダ${showFiles ? `・${placed.length - folders} ファイル` : ""}を表示中`);
}

/** 選んだ印だけを付け替える（図を描き直すと、ダブルクリックの2回目が別の要素に当たる） */
function select(/** @type {string | null} */ key) {
  selected = key;
  for (const el of $world.querySelectorAll(".node")) {
    const p = placed[Number(el.getAttribute("data-i"))];
    el.classList.toggle("is-selected", !!p && p.key === key);
  }
}

function applyView() {
  $world.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.k})`);
  $zoom.textContent = `${Math.round(view.k * 100)}%`;
}

/** 根を左の真ん中に置く */
function goHome() {
  const r = placed[0];
  view = { tx: 24, ty: $stage.clientHeight / 2 - (r ? r.y : 0), k: 1 };
  applyView();
}

/** 枝を開け閉めしたとき、その節が画面の同じ場所に残るようにする */
async function withAnchor(/** @type {string} */ key, /** @type {() => Promise<void> | void} */ change) {
  const before = placed.find((p) => p.key === key);
  await change();
  render();
  const after = placed.find((p) => p.key === key);
  if (before && after) {
    view.ty -= (after.y - before.y) * view.k;
    applyView();
  }
}

async function toggle(/** @type {TNode} */ node) {
  if (node.loading) return;
  await withAnchor(node.entry.path, async () => {
    if (node.open) {
      node.open = false;
    } else {
      if (node.children === null) await loadChildren(node);
      node.open = true;
    }
  });
  saveOpen();
}

// ---- 始める（設定と覚えたものを読んでから、フォルダを受け取る。先に届いたフォルダはランタイムが取っておく） ----

await Promise.all([ep.ready(), sheetsLoaded]);
const settings = await ep.settings.get();
if (typeof settings.initialDepth === "number") initialDepth = settings.initialDepth;
ep.onSettings((values) => {
  if (typeof values.initialDepth === "number") initialDepth = values.initialDepth;
});
// ほかのビューの右クリック「樹形図 › 樹形図で開く」（manifest の menu。ADR 0036）。
// 開くのは右クリックしたタブのフォルダなので、フォルダを選んでいたらそこへ移る（空いている所なら、そのまま）。
// onMenu は 0.7.0 で足された。それより前のアプリでも止まらないよう、あるときだけ使う
ep.onMenu?.(({ id, items }) => {
  if (id === "open" && items[0]?.kind === "folder") void ep.navigate(items[0].path);
});
showFiles = (await ep.storage.get("showFiles")) === true;
const saved = await ep.storage.get("open");
if (saved && typeof saved === "object") openMemory = /** @type {Record<string, string[]>} */ (saved);

// ---- フォルダが届いたとき ----

ep.onFolder(async (folder) => {
  if (root && root.entry.path === folder.path) {
    // 同じフォルダの中身が変わった：直下だけを入れ替え、読んであった枝はそのまま使う
    const old = new Map((root.children ?? []).map((c) => [c.entry.path, c]));
    root.children = folder.entries.map((e) => {
      const prev = old.get(e.path);
      return prev ? { ...prev, entry: e } : { entry: e, children: null, open: false, loading: false, limit: CHILD_PAGE };
    });
    render();
    return;
  }
  const seq = ++loadSeq;
  selected = null;
  drawnKeys = new Set();
  try {
    const t = await ep.getTree({ depth: initialDepth });
    if (seq !== loadSeq) return;
    root = fromTree(t);
  } catch (e) {
    if (seq !== loadSeq) return;
    // 読めないときも、直下だけは onFolder の中身で出す
    root = { entry: { id: folder.id, name: folder.name, path: folder.path, kind: "folder", ext: "", hidden: false }, children: null, open: true, loading: false, limit: CHILD_PAGE };
    root.children = folder.entries.map((e) => ({ entry: e, children: null, open: false, loading: false, limit: CHILD_PAGE }));
    console.warn("getTree", e);
  }
  root.open = true;
  render();
  goHome();
  await restoreOpen(seq);
});

// ---- マウス ----

function placedAt(/** @type {EventTarget | null} */ target) {
  const el = /** @type {Element | null} */ (target instanceof Element ? target.closest("[data-i]") : null);
  return el ? placed[Number(el.getAttribute("data-i"))] : null;
}

$world.addEventListener("click", (ev) => {
  const t = /** @type {Element} */ (ev.target).closest("[data-toggle]");
  if (t) {
    const p = placed[Number(t.getAttribute("data-toggle"))];
    if (p?.node) void toggle(p.node);
    return;
  }
  const p = placedAt(ev.target);
  if (!p) return;
  if (p.more) {
    const m = p.more;
    void withAnchor(p.key, () => { m.parent.limit += CHILD_PAGE; });
    return;
  }
  select(p.key);
});

$world.addEventListener("dblclick", (ev) => {
  if (/** @type {Element} */ (ev.target).closest("[data-toggle]")) return;
  const p = placedAt(ev.target);
  if (!p?.node || p.node === root) return;
  const el = /** @type {Element} */ (/** @type {Element} */ (ev.target).closest("[data-i]"));
  // ファイルは既定のアプリで、フォルダはこのタブで開く（そのフォルダが新しい根になる）
  void ep.open(p.node.entry, { from: el.getBoundingClientRect() });
});

$world.addEventListener("contextmenu", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  const p = placedAt(ev.target);
  if (!p?.node) return;
  const node = p.node;
  select(p.key);
  const isFolder = node.entry.kind === "folder";
  /** @type {{ id: string, label: string }[]} */
  const extra = [];
  if (isFolder && node !== root) extra.push({ id: "toggle", label: node.open ? "枝をたたむ" : "枝を開く" });
  if (isFolder) extra.push({ id: "openDeep", label: "下を3段まで全部開く" });
  if (isFolder && node !== root) extra.push({ id: "collapseOthers", label: "この枝だけ残してたたむ" });
  const { chosen } = await ep.showMenu({ x: ev.clientX, y: ev.clientY, items: [node.entry], extra });
  if (chosen === "toggle") await toggle(node);
  if (chosen === "openDeep") {
    await withAnchor(p.key, async () => {
      await loadChildren(node, 3);
      node.open = true;
    });
    saveOpen();
  }
  if (chosen === "collapseOthers") {
    const keep = new Set();
    for (let q = /** @type {Placed | null} */ (p); q; q = q.parent) keep.add(q.key);
    await withAnchor(p.key, () => {
      if (root) walk(root, (n) => { if (n !== root && !keep.has(n.entry.path) && !n.entry.path.startsWith(`${p.key}\\`)) n.open = false; });
    });
    saveOpen();
  }
});

// 背景をつかんで動かす
/** @type {{ x: number, y: number, tx: number, ty: number } | null} */
let pan = null;
$stage.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || placedAt(ev.target)) return;
  pan = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty };
  $stage.setPointerCapture(ev.pointerId);
  $stage.classList.add("is-panning");
});
$stage.addEventListener("pointermove", (ev) => {
  if (!pan) return;
  view.tx = pan.tx + ev.clientX - pan.x;
  view.ty = pan.ty + ev.clientY - pan.y;
  applyView();
});
const endPan = () => {
  pan = null;
  $stage.classList.remove("is-panning");
};
$stage.addEventListener("pointerup", endPan);
$stage.addEventListener("pointercancel", endPan);
$stage.addEventListener("click", (ev) => {
  if (!placedAt(ev.target) && selected) select(null);
});

// ホイール：上下に動かす。Shift で左右、Ctrl で拡大・縮小（カーソルの位置を中心に）
$stage.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey) {
    const box = $stage.getBoundingClientRect();
    const mx = ev.clientX - box.left;
    const my = ev.clientY - box.top;
    const k = Math.min(3, Math.max(0.2, view.k * Math.exp(-ev.deltaY * 0.0015)));
    view.tx = mx - ((mx - view.tx) * k) / view.k;
    view.ty = my - ((my - view.ty) * k) / view.k;
    view.k = k;
  } else if (ev.shiftKey) {
    view.tx -= ev.deltaY;
  } else {
    view.tx -= ev.deltaX;
    view.ty -= ev.deltaY;
  }
  applyView();
}, { passive: false });

// ---- キーボード（補助。ADR 0013） ----

$stage.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey || ev.altKey) return;
  const i = placed.findIndex((p) => p.key === selected);
  const cur = i >= 0 ? placed[i] : null;
  /** @type {Placed | null | undefined} */
  let next = null;
  if (!cur) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) next = placed[0];
  } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    // 同じ列で、上・下にいちばん近いもの
    const dir = ev.key === "ArrowDown" ? 1 : -1;
    next = placed.filter((p) => p.depth === cur.depth && (p.y - cur.y) * dir > 0).sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y))[0];
  } else if (ev.key === "ArrowLeft") {
    if (cur.node && cur.node.open && cur.node !== root) void toggle(cur.node);
    else next = cur.parent;
  } else if (ev.key === "ArrowRight") {
    if (cur.node && cur.node.entry.kind === "folder" && !cur.node.open) void toggle(cur.node);
    else next = placed.find((p) => p.parent === cur);
  } else if (ev.key === "Enter" && cur.node && cur.node !== root) {
    void ep.open(cur.node.entry);
  } else if (ev.key === " " && cur.node && cur.node.entry.kind === "folder" && cur.node !== root) {
    void toggle(cur.node);
  } else if (ev.key === "Backspace") {
    void ep.navigateUp();
  } else {
    return;
  }
  ev.preventDefault();
  if (next) {
    select(next.key);
    scrollIntoView(next);
  }
});

/** 選んだ節が画面の外なら、見えるところまで動かす */
function scrollIntoView(/** @type {Placed} */ p) {
  const sx = view.tx + p.x * view.k;
  const sy = view.ty + p.y * view.k;
  const w = $stage.clientWidth;
  const h = $stage.clientHeight;
  if (sx < 16) view.tx += 16 - sx;
  if (sx + p.w * view.k > w - 16) view.tx -= sx + p.w * view.k - (w - 16);
  if (sy < 24) view.ty += 24 - sy;
  if (sy > h - 24) view.ty -= sy - (h - 24);
  applyView();
}

// ---- 上の帯のボタン ----

$("up").onclick = () => void ep.navigateUp();
$files.onclick = () => {
  showFiles = !showFiles;
  void ep.storage.set("showFiles", showFiles);
  render();
};
$("collapse").onclick = () => {
  if (!root) return;
  walk(root, (n) => { if (n !== root) n.open = false; });
  render();
  goHome();
  saveOpen();
};
$("home").onclick = () => goHome();
$("reload").onclick = async () => {
  if (!root) return;
  // 開いている枝を読み直す（下の階層の変化は見張っていないので、手で読み直す。ADR 0018）
  const seq = ++loadSeq;
  const keepOpen = new Set();
  walk(root, (n) => { if (n.open) keepOpen.add(n.entry.path); });
  const t = await ep.getTree({ depth: initialDepth }).catch(() => null);
  if (!t || seq !== loadSeq) return;
  root = fromTree(t);
  root.open = true;
  openMemory[rootKey()] = [...keepOpen];
  render();
  await restoreOpen(seq);
};
