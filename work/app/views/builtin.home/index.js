// 標準のビュー「ホーム」（ADR 0014 判断2・ADR 0029）。新しいタブで開く。3つの欄だけ：
// - 最近使った項目：押すと開く（フォルダは Win11 風ビューでこのタブに開く）
// - MOD：入れる・外す・設定・作る（ADR 0020）。MOD の zip をこのタブに落としても入れられる
// - ログ：explorer_plus 本体のログと、MOD ごとのログ（console.log・エラー・その MOD が本体に頼んだこと）。新しいものが流れてくる
const ep = window.explorerPlus;
const FOLDER_VIEW = "builtin.win11";

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.head.appendChild(
  Object.assign(document.createElement("style"), {
    textContent: `
      body.tui { display: grid; grid-template-rows: minmax(0, 1fr) minmax(0, 1.1fr); gap: 10px; padding: 14px 10px 10px; box-sizing: border-box; height: 100vh; }
      .top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 10px; min-height: 0; }
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
      select.tui-input { padding: 0 4px; }
    `,
  }),
);

document.body.className = "tui";
document.body.innerHTML = `
  <div class="top">
    <section class="tui-box"><span class="tui-box-title">最近使った項目</span><div class="tui-scroll" id="recent"></div></section>
    <section class="tui-box">
      <span class="tui-box-title">MOD</span>
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
  </div>
  <section class="tui-box">
    <span class="tui-box-title">ログ</span>
    <div class="tui-toolbar">
      <div class="log-sources" id="log-sources"></div>
      <span class="tui-grow"></span>
      <select class="tui-input" id="log-level" title="出す重さ">
        <option value="info">すべて</option>
        <option value="warn">警告とエラー</option>
        <option value="error">エラーだけ</option>
      </select>
      <button class="tui-button" id="log-copy">コピー</button>
      <button class="tui-button" id="log-clear">消す</button>
    </div>
    <div class="tui-scroll" id="log"></div>
  </section>`;

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

ep.onMods(async () => {
  await renderMods();
  renderSources();
});
ep.onRecent(renderRecent);

ep.ready().then(async () => {
  const level = await ep.storage.get("logLevel").catch(() => undefined);
  if (level === "warn" || level === "error") $level.value = level;
  await Promise.all([renderRecent(), renderMods()]);
  sources = await ep.logs.sources().catch(() => []);
  await showLog("app");
});
