// 標準のビュー「ホーム」（ADR 0014 判断2・ADR 0029）。新しいタブで開く。3つの欄だけ：
// - 最近使った項目：押すと開く（フォルダは Win11 風ビューでこのタブに開く）
// - MOD：入れる・外す・設定・作る（ADR 0020）。MOD の zip をこのタブに落としても入れられる
// - ログ：explorer_plus 本体のログと、MOD ごとのログ（console.log・エラー・その MOD が本体に頼んだこと）。新しいものが流れてくる
// 欄の配置と大きさは、VS Code のように変えられる（ADR 0031）：境目をドラッグ・題名をつかんでほかの欄の端へ。配置は覚える
import { DEFAULT_LAYOUT, movePanel, resizePair, validLayout, zoneAt } from "./layout.js";

const ep = window.explorerPlus;
const FOLDER_VIEW = "builtin.win11";

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.head.appendChild(
  Object.assign(document.createElement("style"), {
    textContent: `
      body.tui { padding: 14px 10px 10px; box-sizing: border-box; height: 100vh; margin: 0; overflow: hidden; }
      #layout { height: 100%; display: flex; }
      /* 欄を分けた入れ物（split）と欄（slot）。境目（splitter）は、つかんで大きさを変える */
      .split { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
      .split.row { flex-direction: row; }
      .split.col { flex-direction: column; }
      .slot { display: flex; min-width: 0; min-height: 0; position: relative; }
      .slot > .tui-box { flex: 1; }
      .splitter { flex: none; position: relative; }
      .split.row > .splitter { width: 10px; cursor: col-resize; }
      .split.col > .splitter { height: 10px; cursor: row-resize; }
      .splitter::after { content: ""; position: absolute; inset: 0; margin: auto; background: transparent; transition: background 0.1s; }
      .split.row > .splitter::after { width: 2px; }
      .split.col > .splitter::after { height: 2px; }
      .splitter:hover::after, .splitter.is-dragging::after { background: var(--tui-accent); }
      /* 欄の題名をつかんで動かす */
      .tui-box-title.grip { cursor: grab; user-select: none; }
      .tui-box-title.grip:hover { color: var(--tui-accent); }
      body.moving, body.moving * { cursor: grabbing !important; user-select: none; }
      .drop-zone { position: fixed; pointer-events: none; border: 2px solid var(--tui-accent); background: color-mix(in srgb, var(--tui-accent) 18%, transparent); z-index: 20; transition: all 0.08s; }
      .drop-zone[hidden], .move-ghost[hidden] { display: none; }
      .move-ghost { position: fixed; pointer-events: none; z-index: 21; padding: 0 1ch; border: 1px solid var(--tui-accent); background: var(--tui-bg); color: var(--tui-accent); }
      /* 自前の選び方（ブラウザのプルダウンの代わり） */
      .pick-btn::after { content: " ▾]"; color: var(--tui-dim); margin-left: 0; }
      .pick-menu { position: fixed; z-index: 30; min-width: 16ch; border: 1px solid var(--tui-accent); background: var(--tui-bg); box-shadow: 0 6px 18px color-mix(in srgb, #000 35%, transparent); padding: 2px 0; }
      .pick-menu[hidden] { display: none; }
      .pick-item { display: flex; gap: 1ch; padding: 1px 1.5ch 1px 1ch; cursor: pointer; white-space: nowrap; }
      .pick-item::before { content: " "; width: 1ch; color: var(--tui-accent); }
      .pick-item.is-on::before { content: "●"; }
      .pick-item:hover, .pick-item.is-cursor { background: var(--tui-sel-bg); color: var(--tui-sel-fg); }
      .row-icon { width: 16px; height: 16px; flex: none; }
      .tui-toolbar { padding: 2px 1ch 6px; flex-wrap: wrap; }
      .mod-source { font-size: 11px; color: var(--tui-dim); white-space: nowrap; }
      .mod-source.dev { color: var(--tui-accent); }
      .mod { padding: 2px 1ch 4px 2.5ch; border-bottom: 1px dotted var(--tui-line); }
      .mod-head { display: flex; align-items: center; gap: 1ch; flex-wrap: wrap; }
      .mod-desc { color: var(--tui-dim); white-space: normal; }
      .mod-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
      .mod-actions .tui-button { padding: 0 4px; }
      .problem { white-space: normal; }
      .tui-ask[hidden] { display: none; }
      .log-sources { display: flex; gap: 2px; flex-wrap: wrap; }
      .log-source { font: inherit; background: transparent; color: var(--tui-dim); border: 1px solid transparent; padding: 0 1ch; cursor: pointer; }
      .log-source:hover { color: var(--tui-fg); }
      .log-source.is-on { color: var(--tui-accent); border-color: var(--tui-accent); }
      .log-source .count { color: var(--tui-warn); margin-left: 0.5ch; }
      .log-line { display: flex; gap: 1ch; padding: 0 1ch; white-space: pre-wrap; word-break: break-all; line-height: 1.45; }
      .log-line .time { color: var(--tui-dim); flex: none; }
      .log-line .level { flex: none; width: 6ch; }
      .log-line.warn .level { color: var(--tui-now); }
      .log-line.error .level, .log-line.error .text { color: var(--tui-warn); }
      .log-empty { padding: 0 1ch; color: var(--tui-dim); }
    `,
  }),
);

document.body.className = "tui";
document.body.innerHTML = `
  <div id="layout"></div>
  <div id="panels" hidden>
    <section class="tui-box" data-panel="recent"><span class="tui-box-title grip" title="つかんで動かす（右クリックで配置を元に戻す）">最近使った項目</span><div class="tui-scroll" id="recent"></div></section>
    <section class="tui-box" data-panel="mods">
      <span class="tui-box-title grip" title="つかんで動かす（右クリックで配置を元に戻す）">MOD</span>
      <div class="tui-toolbar">
        <button class="tui-button is-accent" id="install">＋ MOD を入れる（zip）</button>
        <span class="tui-dim">zip をこのタブに落としても入れられます</span>
      </div>
      <div class="tui-scroll" id="mods"></div>
      <div class="tui-toolbar">
        <span class="tui-dim">作る：</span>
        <button class="tui-button" id="create">ひな形から作る…</button>
        <button class="tui-button" id="add-dev">開発中のフォルダを読み込む…</button>
        <button class="tui-button" id="docs">MOD 開発ガイド</button>
        <button class="tui-button" id="devtools">開発者ツール</button>
      </div>
      <div class="tui-ask" id="ask" hidden>
        <span class="tui-ask-label">新しい MOD の名前：</span>
        <input class="tui-input" id="ask-name" maxlength="40" placeholder="例：写真マップ" />
        <button class="tui-button is-accent" id="ask-ok">作る場所を選ぶ</button>
        <button class="tui-button" id="ask-cancel">やめる</button>
      </div>
    </section>
    <section class="tui-box" data-panel="logs">
    <span class="tui-box-title grip" title="つかんで動かす（右クリックで配置を元に戻す）">ログ</span>
    <div class="tui-toolbar">
      <div class="log-sources" id="log-sources"></div>
      <span class="tui-grow"></span>
      <button class="tui-button pick-btn" id="log-level" value="info" title="出す重さ">すべて</button>
      <button class="tui-button" id="log-copy">コピー</button>
      <button class="tui-button" id="log-clear">消す</button>
    </div>
    <div class="tui-scroll" id="log"></div>
    </section>
  </div>
  <div class="drop-zone" id="drop-zone" hidden></div>
  <div class="move-ghost" id="move-ghost" hidden></div>
  <div class="pick-menu" id="pick-menu" hidden></div>`;

const $recent = document.getElementById("recent");
const $mods = document.getElementById("mods");
const $ask = document.getElementById("ask");
const $askName = document.getElementById("ask-name");
const $logSources = document.getElementById("log-sources");
const $log = document.getElementById("log");
const $level = document.getElementById("log-level");

const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text !== undefined ? { textContent: text } : {});

function parentOf(path) {
  const i = path.replace(/\\+$/, "").lastIndexOf("\\");
  return i > 2 ? path.slice(0, i) : path.slice(0, 3);
}

function button(text, run, title) {
  const b = el("button", "tui-button", text);
  if (title) b.title = title;
  b.onclick = (e) => {
    e.stopPropagation();
    run();
  };
  return b;
}

// ---- 最近使った項目 ----

function openEntry(entry) {
  if (entry.kind === "folder") ep.tabs.open(FOLDER_VIEW, { path: entry.path, replace: true }).catch(console.warn);
  else ep.open(entry).catch(console.warn);
}

async function renderRecent() {
  const items = await ep.recent.list().catch(() => []);
  $recent.textContent = "";
  if (items.length === 0) $recent.append(el("div", "tui-row tui-dim", "まだありません（このアプリで開いたファイルが並びます）"));
  for (const e of items) {
    const r = el("div", "tui-row");
    if (e.iconUrl) r.append(Object.assign(el("img", "row-icon"), { src: e.iconUrl, alt: "" }));
    r.append(el("span", undefined, e.name), el("span", "tui-grow tui-dim", parentOf(e.path)));
    r.title = e.path;
    r.onclick = () => openEntry(e);
    r.oncontextmenu = async (ev) => {
      ev.preventDefault();
      const menu = [
        { id: "open", label: "開く", run: () => openEntry(e) },
        { id: "folder", label: "ファイルの場所を開く", run: () => ep.tabs.open(FOLDER_VIEW, { path: parentOf(e.path), replace: true }) },
      ];
      const { chosen } = await ep.showMenu({ x: ev.clientX, y: ev.clientY, items: [], extra: menu });
      menu.find((m) => m.id === chosen)?.run();
    };
    $recent.append(r);
  }
}

// ---- MOD（ADR 0020） ----

const SOURCE_LABEL = { user: "入れた MOD", dev: "開発中" };
/** ログの欄で使う、MOD の名前 */
let modNames = new Map();

async function renderMods() {
  const { mods, problems } = await ep.mods.list().catch(() => ({ mods: [], problems: [] }));
  modNames = new Map(mods.map((m) => [m.id, m.name]));
  $mods.textContent = "";
  const own = mods.filter((m) => m.source !== "builtin");
  if (own.length === 0 && problems.length === 0) $mods.append(el("div", "tui-row tui-dim", "まだ入っていません。入れた MOD は、タブの ▸ から選べます"));
  for (const m of own) {
    const r = el("div", "mod");
    const actions = el("span", "mod-actions");
    if (m.hasSettings) actions.append(button("設定", () => ep.mods.openSettings(m.id).catch(console.warn)));
    actions.append(button("ログ", () => showLog(m.id), "この MOD のログを下に出す"));
    actions.append(button("フォルダ", () => ep.mods.openFolder(m.id)));
    if (m.source === "dev") actions.append(button("zip にする", () => ep.mods.pack(m.id).catch(console.warn)));
    actions.append(button(m.source === "dev" ? "読み込みをやめる" : "外す", () => ep.mods.remove(m.id).catch(() => {})));
    const head = el("div", "mod-head");
    head.append(
      el("span", undefined, `${m.name} ${m.version}`),
      el("span", `mod-source ${m.source}`, SOURCE_LABEL[m.source] || m.source),
      ...(m.network && m.network.length ? [Object.assign(el("span", "mod-source", "通信あり"), { title: m.network.join("\n") })] : []),
      actions,
    );
    r.append(head, el("div", "mod-desc", m.description || m.id));
    r.title = `${m.id}\n${m.dir}`;
    $mods.append(r);
  }
  // 読み込めなかった MOD は、作っている人が直せるように、理由をそのまま出す
  for (const p of problems) $mods.append(el("div", "tui-row tui-warn problem", `読み込めません：${p.dir} — ${p.errors.join(" / ")}`));
}

document.getElementById("install").onclick = () => ep.mods.install().catch(console.warn);
document.getElementById("add-dev").onclick = () => ep.mods.addDev().catch(console.warn);
document.getElementById("docs").onclick = () => ep.mods.openDocs().catch(console.warn);
document.getElementById("devtools").onclick = () => ep.mods.openDevtools().catch(console.warn);
document.getElementById("create").onclick = () => {
  $ask.hidden = false;
  $askName.value = "";
  $askName.focus();
};
const closeAsk = () => ($ask.hidden = true);
async function createMod() {
  const name = $askName.value.trim();
  if (!name) return $askName.focus();
  closeAsk();
  await ep.mods.createDev(name).catch(console.warn);
}
document.getElementById("ask-ok").onclick = createMod;
document.getElementById("ask-cancel").onclick = closeAsk;
$askName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void createMod();
  if (e.key === "Escape") closeAsk();
});

// ---- ログ（ADR 0029） ----

const LEVEL_RANK = { info: 0, warn: 1, error: 2 };
const LEVEL_LABEL = { info: "情報", warn: "警告", error: "エラー" };
let source = "app";
let sources = [];
/** 見ていない出どころの、新しく増えたエラーの数 */
const unseen = new Map();
let shown = [];

const pad = (n) => String(n).padStart(2, "0");
function timeOf(t) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const nameOf = (id) => (id === "app" ? "explorer_plus" : modNames.get(id) || id);

function renderSources() {
  $logSources.textContent = "";
  for (const id of ["app", ...sources]) {
    const b = el("button", `log-source${id === source ? " is-on" : ""}`, nameOf(id));
    const n = unseen.get(id);
    if (n) b.append(el("span", "count", String(n)));
    b.title = id === "app" ? "explorer_plus 本体のログ" : `${id} のログ`;
    b.onclick = () => showLog(id);
    $logSources.append(b);
  }
}

function lineOf(e) {
  const r = el("div", `log-line ${e.level}`);
  r.append(el("span", "time", timeOf(e.t)), el("span", "level", LEVEL_LABEL[e.level]), el("span", "text", e.text));
  return r;
}

function visible(e) {
  return LEVEL_RANK[e.level] >= LEVEL_RANK[$level.value];
}

function renderLog() {
  $log.textContent = "";
  const list = shown.filter(visible);
  if (list.length === 0) $log.append(el("div", "log-empty", source === "app" ? "まだありません" : "まだありません（この MOD の console.log・エラー・本体に頼んだことが出ます）"));
  for (const e of list) $log.append(lineOf(e));
  $log.scrollTop = $log.scrollHeight;
}

async function showLog(id) {
  source = id;
  unseen.delete(id);
  if (id !== "app" && !sources.includes(id)) sources = [...sources, id].sort();
  renderSources();
  shown = await ep.logs.list(id).catch(() => []);
  if (source === id) renderLog();
}

ep.onLogs((e) => {
  if (e.source === source) {
    shown.push(e);
    if (shown.length > 1000) shown.shift();
    if (!visible(e)) return;
    // いちばん下を見ているときだけ、新しいものへ動かす
    const atBottom = $log.scrollHeight - $log.scrollTop - $log.clientHeight < 24;
    $log.querySelector(".log-empty")?.remove();
    $log.append(lineOf(e));
    if ($log.children.length > 1000) $log.firstChild.remove();
    if (atBottom) $log.scrollTop = $log.scrollHeight;
    return;
  }
  if (e.source !== "app" && !sources.includes(e.source)) sources = [...sources, e.source].sort();
  if (e.level === "error") unseen.set(e.source, (unseen.get(e.source) || 0) + 1);
  renderSources();
});

// ---- 出す重さの選び方（ブラウザのプルダウンは見た目が浮くので、TUI に合わせた自前のメニュー） ----

const LEVEL_OPTIONS = [
  { value: "info", label: "すべて" },
  { value: "warn", label: "警告とエラー" },
  { value: "error", label: "エラーだけ" },
];
const $pick = document.getElementById("pick-menu");

function setLevel(value) {
  const o = LEVEL_OPTIONS.find((x) => x.value === value) ?? LEVEL_OPTIONS[0];
  $level.value = o.value;
  $level.textContent = o.label;
}

function closePick() {
  $pick.hidden = true;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onPickKey, true);
}
function onOutside(e) {
  if (!$pick.contains(e.target) && e.target !== $level) closePick();
}
let pickCursor = 0;
function paintPick() {
  [...$pick.children].forEach((c, i) => c.classList.toggle("is-cursor", i === pickCursor));
}
function choose(value) {
  closePick();
  if (value === $level.value) return;
  setLevel(value);
  $level.onchange();
  $level.focus();
}
function onPickKey(e) {
  if (e.key === "Escape") closePick();
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    pickCursor = (pickCursor + (e.key === "ArrowDown" ? 1 : -1) + LEVEL_OPTIONS.length) % LEVEL_OPTIONS.length;
    paintPick();
  } else if (e.key === "Enter" || e.key === " ") choose(LEVEL_OPTIONS[pickCursor].value);
  else return;
  e.preventDefault();
  e.stopPropagation();
}
$level.onclick = () => {
  if (!$pick.hidden) return closePick();
  $pick.textContent = "";
  for (const o of LEVEL_OPTIONS) {
    const item = el("div", `pick-item${o.value === $level.value ? " is-on" : ""}`, o.label);
    item.onclick = () => choose(o.value);
    $pick.append(item);
  }
  pickCursor = Math.max(0, LEVEL_OPTIONS.findIndex((o) => o.value === $level.value));
  paintPick();
  const r = $level.getBoundingClientRect();
  $pick.hidden = false;
  // 下に入らなければ上に出す。右端からはみ出さないように
  const h = $pick.offsetHeight;
  const w = $pick.offsetWidth;
  $pick.style.top = `${r.bottom + h + 4 > innerHeight ? Math.max(4, r.top - h - 2) : r.bottom + 2}px`;
  $pick.style.left = `${Math.min(r.left, innerWidth - w - 4)}px`;
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onPickKey, true);
};

$level.onchange = () => {
  void ep.storage.set("logLevel", $level.value).catch(() => {});
  renderLog();
};
document.getElementById("log-clear").onclick = async () => {
  if (!(await ep.ui.confirm(`「${nameOf(source)}」のログを消しますか？`, { okLabel: "消す" }).catch(() => false))) return;
  await ep.logs.clear(source).catch(console.warn);
  shown = [];
  renderLog();
};
document.getElementById("log-copy").onclick = () => {
  const text = shown.filter(visible).map((e) => `${timeOf(e.t)} ${LEVEL_LABEL[e.level]} ${e.text}`).join("\n");
  // ビューの画面は隔離されているので、navigator.clipboard は使えないことがある。そのときは選んでコピーする
  const fallback = () => {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  };
  const done = (ok) => ep.ui.toast(ok ? "ログをコピーしました" : "コピーできませんでした");
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback()));
  else done(fallback());
};

// ---- 欄の配置（ADR 0031） ----

const $layout = document.getElementById("layout");
const $zone = document.getElementById("drop-zone");
const $ghost = document.getElementById("move-ghost");
const PANEL_EL = Object.fromEntries([...document.querySelectorAll("[data-panel]")].map((e) => [e.dataset.panel, e]));
const PANEL_NAME = { recent: "最近使った項目", mods: "MOD", logs: "ログ" };
// 既定の配置は書き換えないよう、写しを使う（境目を動かすと割合を書き換えるため）
const freshLayout = () => JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
let layout = freshLayout();

function saveLayout() {
  void ep.storage.set("layout", layout).catch(() => {});
}

/** 配置の木から画面を作る。欄そのもの（section）は作り直さず、入れ物だけ作り直して移す（中身や状態はそのまま） */
function renderLayout() {
  const build = (node) => {
    if (typeof node === "string") {
      const slot = el("div", "slot");
      slot.dataset.panel = node;
      slot.append(PANEL_EL[node]);
      return slot;
    }
    const box = el("div", `split ${node.dir}`);
    const parts = node.children.map(build);
    parts.forEach((part, i) => {
      part.style.flex = `${node.sizes[i]} 1 0`;
      if (i > 0) box.append(splitter(node, i - 1, box, parts));
      box.append(part);
    });
    return box;
  };
  const root = build(layout);
  if (root.classList.contains("slot")) root.style.flex = "1 1 0";
  $layout.replaceChildren(root);
}

/** 境目：つかんで動かすと、両側の割合を変える */
function splitter(node, i, box, parts) {
  const s = el("div", "splitter");
  s.title = "ドラッグで大きさを変える";
  s.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    s.setPointerCapture(down.pointerId);
    s.classList.add("is-dragging");
    const row = node.dir === "row";
    const r = box.getBoundingClientRect();
    const total = (row ? r.width : r.height) - (node.children.length - 1) * 10;
    const start = row ? down.clientX : down.clientY;
    const before = [...node.sizes];
    const move = (e) => {
      const delta = ((row ? e.clientX : e.clientY) - start) / Math.max(total, 1);
      node.sizes = resizePair(before, i, delta, Math.min(0.4, 120 / Math.max(total, 1)));
      parts.forEach((p, k) => (p.style.flex = `${node.sizes[k]} 1 0`));
    };
    const up = () => {
      s.removeEventListener("pointermove", move);
      s.removeEventListener("pointerup", up);
      s.removeEventListener("pointercancel", up);
      s.classList.remove("is-dragging");
      saveLayout();
    };
    s.addEventListener("pointermove", move);
    s.addEventListener("pointerup", up);
    s.addEventListener("pointercancel", up);
  });
  // ダブルクリックで、両側を同じ大きさに
  s.addEventListener("dblclick", () => {
    const half = (node.sizes[i] + node.sizes[i + 1]) / 2;
    node.sizes[i] = node.sizes[i + 1] = half;
    parts.forEach((p, k) => (p.style.flex = `${node.sizes[k]} 1 0`));
    saveLayout();
  });
  return s;
}

/** 欄の題名をつかんで動かす：ほかの欄の端に落とすとその端へ、真ん中なら入れ替える */
function enablePanelMove(id) {
  const grip = PANEL_EL[id].querySelector(".grip");
  grip.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    // 題名は小さいので、押したらすぐポインタをつかまえる（素早く動かしても、外れないように）
    grip.setPointerCapture(down.pointerId);
    let moving = false;
    let target = null;
    const move = (e) => {
      if (!moving && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
      if (!moving) {
        moving = true;
        document.body.classList.add("moving");
        $ghost.textContent = PANEL_NAME[id];
        $ghost.hidden = false;
      }
      $ghost.style.left = `${e.clientX + 12}px`;
      $ghost.style.top = `${e.clientY + 12}px`;
      const slot = [...$layout.querySelectorAll(".slot")].find((sl) => {
        const r = sl.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      });
      target = null;
      $zone.hidden = true;
      if (!slot || slot.dataset.panel === id) return;
      const r = slot.getBoundingClientRect();
      const zone = zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      target = { id: slot.dataset.panel, zone };
      // 落としたときに入る場所を、色で見せる
      const z = { left: r.left, top: r.top, width: r.width, height: r.height };
      if (zone === "left" || zone === "right") z.width = r.width / 2;
      if (zone === "right") z.left = r.left + r.width / 2;
      if (zone === "top" || zone === "bottom") z.height = r.height / 2;
      if (zone === "bottom") z.top = r.top + r.height / 2;
      Object.assign($zone.style, { left: `${z.left}px`, top: `${z.top}px`, width: `${z.width}px`, height: `${z.height}px` });
      $zone.hidden = false;
    };
    const up = (e) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      document.body.classList.remove("moving");
      $ghost.hidden = true;
      $zone.hidden = true;
      if (!moving || !target || e.type !== "pointerup") return;
      layout = movePanel(layout, id, target.id, target.zone);
      renderLayout();
      saveLayout();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    const { chosen } = await ep.showMenu({ x: e.clientX, y: e.clientY, items: [], extra: [{ id: "reset", label: "配置を元に戻す" }] });
    if (chosen === "reset") {
      layout = freshLayout();
      renderLayout();
      saveLayout();
    }
  });
}

for (const id of Object.keys(PANEL_EL)) enablePanelMove(id);
renderLayout();

ep.onMods(async () => {
  await renderMods();
  renderSources();
});
ep.onRecent(renderRecent);

ep.ready().then(async () => {
  const saved = await ep.storage.get("layout").catch(() => undefined);
  if (validLayout(saved)) {
    layout = saved;
    renderLayout();
  }
  const level = await ep.storage.get("logLevel").catch(() => undefined);
  setLevel(level === "warn" || level === "error" ? level : "info");
  await Promise.all([renderRecent(), renderMods()]);
  sources = await ep.logs.sources().catch(() => []);
  await showLog("app");
});
