// 標準のビュー「ホーム」（ADR 0014 判断2）。新しいタブで開く。
// 上でビューを選び、クイックアクセスや最近使った項目を押すと、そのビューでこのタブに開く（Win11 のホームと同じく、このタブが置き換わる）。
// 下の「MOD」で、MOD を入れる・外す・作る（ADR 0020）。MOD の zip をこのタブに落としても入れられる。
const ep = window.explorerPlus;

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.head.appendChild(
  Object.assign(document.createElement("style"), {
    textContent: `
      .views { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 10px 8px; }
      .view-card { font: inherit; text-align: left; width: 22ch; padding: 6px 1ch; border: 1px solid var(--tui-line); background: transparent; color: var(--tui-fg); cursor: pointer; }
      .view-card:hover { border-color: var(--tui-accent); }
      .view-card.is-chosen { border-color: var(--tui-accent); box-shadow: inset 0 0 0 1px var(--tui-accent); }
      .view-card .name { display: block; }
      .view-card .note { display: block; font-size: 11px; color: var(--tui-dim); }
      .row-icon { width: 16px; height: 16px; flex: none; }
      .lists { flex: 1; min-height: 0; display: flex; gap: 8px; padding: 10px; }
      .lists > .tui-box { flex: 1; }
      .mods { margin: 0 10px 10px; max-height: 42vh; }
      .mods .tui-toolbar { padding: 4px 1ch 6px; }
      .mod-source { font-size: 11px; color: var(--tui-dim); white-space: nowrap; }
      .mod-source.dev { color: var(--tui-accent); }
      .mod-actions { display: flex; gap: 4px; }
      .mod-actions .tui-button { padding: 0 4px; }
      .problem { white-space: normal; }
      .tui-ask[hidden] { display: none; }
    `,
  }),
);

document.body.className = "tui";
document.body.innerHTML = `
  <section class="tui-box" style="margin: 14px 10px 0">
    <span class="tui-box-title">ビュー（フォルダを開くときの見せ方を選ぶ）</span>
    <div class="views" id="views"></div>
  </section>
  <div class="lists">
    <section class="tui-box"><span class="tui-box-title">クイックアクセス</span><div class="tui-scroll" id="quick"></div></section>
    <section class="tui-box"><span class="tui-box-title">最近使った項目</span><div class="tui-scroll" id="recent"></div></section>
  </div>
  <section class="tui-box mods">
    <span class="tui-box-title">MOD（ビューを足す）</span>
    <div class="tui-toolbar">
      <button class="tui-button is-accent" id="install">＋ MOD を入れる（zip）</button>
      <span class="tui-dim">zip をこのタブに落としても入れられます</span>
      <span class="tui-grow"></span>
    </div>
    <div class="tui-scroll" id="mods"></div>
    <div class="tui-toolbar">
      <span class="tui-dim">MOD を作る：</span>
      <button class="tui-button" id="create">ひな形から作る…</button>
      <button class="tui-button" id="add-dev">開発中のフォルダを読み込む…</button>
      <button class="tui-button" id="docs">MOD 開発ガイド</button>
      <button class="tui-button" id="devtools" title="MOD のエラーは、ここのコンソールに出ます">開発者ツール</button>
    </div>
    <div class="tui-ask" id="ask" hidden>
      <span class="tui-ask-label">新しい MOD の名前：</span>
      <input class="tui-input" id="ask-name" maxlength="40" placeholder="例：写真マップ" />
      <button class="tui-button is-accent" id="ask-ok">作る場所を選ぶ</button>
      <button class="tui-button" id="ask-cancel">やめる</button>
    </div>
  </section>`;

const $views = document.getElementById("views");
const $quick = document.getElementById("quick");
const $recent = document.getElementById("recent");
const $mods = document.getElementById("mods");
const $ask = document.getElementById("ask");
const $askName = document.getElementById("ask-name");

let views = [];
let chosen = "builtin.win11"; // フォルダを開くときのビュー（最後に選んだものを覚えておく）

function parentOf(path) {
  const i = path.lastIndexOf("\\");
  return i > 0 ? path.slice(0, i) : path;
}

function renderViews() {
  $views.textContent = "";
  for (const v of views) {
    const card = document.createElement("button");
    card.className = "view-card";
    const folderView = v.location === "folder";
    if (folderView && v.id === chosen) card.classList.add("is-chosen");
    card.append(
      Object.assign(document.createElement("span"), { className: "name", textContent: `${folderView && v.id === chosen ? "● " : ""}${v.name}` }),
      Object.assign(document.createElement("span"), { className: "note", textContent: folderView ? "フォルダを開くときに使う" : "押すと開く" }),
    );
    card.title = v.description || v.name;
    card.onclick = () => {
      if (folderView) {
        chosen = v.id;
        ep.storage.set("chosen", chosen).catch(() => {});
        renderViews();
      } else {
        // フォルダと関係ないビュー（タグなど）は、そのままこのタブで開く
        ep.tabs.open(v.id, { replace: true }).catch(console.warn);
      }
    };
    $views.append(card);
  }
}

function row(entry, onOpen, extraMenu) {
  const r = document.createElement("div");
  r.className = "tui-row";
  if (entry.iconUrl) r.append(Object.assign(document.createElement("img"), { className: "row-icon", src: entry.iconUrl, alt: "" }));
  r.append(
    Object.assign(document.createElement("span"), { textContent: entry.name }),
    Object.assign(document.createElement("span"), { className: "tui-grow tui-dim", textContent: parentOf(entry.path) }),
  );
  r.title = entry.path;
  r.onclick = onOpen;
  r.oncontextmenu = async (e) => {
    e.preventDefault();
    const { chosen: id } = await ep.showMenu({ x: e.clientX, y: e.clientY, items: [], extra: extraMenu });
    if (id) extraMenu.find((m) => m.id === id)?.run();
  };
  return r;
}

/** フォルダは、選んだビューでこのタブに開く。ファイルは既定のアプリで開く */
function openEntry(entry) {
  if (entry.kind === "folder") ep.tabs.open(chosen, { path: entry.path, replace: true }).catch(console.warn);
  else ep.open(entry).catch(console.warn);
}

async function renderQuick() {
  const items = await ep.quickAccess.list().catch(() => []);
  $quick.textContent = "";
  if (items.length === 0) {
    $quick.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "フォルダを右クリック →「クイックアクセスにピン留め」で並びます" }));
  }
  for (const e of items) {
    $quick.append(
      row(e, () => openEntry(e), [
        { id: "open", label: "開く", run: () => openEntry(e) },
        { id: "newtab", label: "新しいタブで開く", run: () => ep.tabs.open(chosen, { path: e.path }) },
        { id: "unpin", label: "クイックアクセスから外す", run: () => ep.quickAccess.unpin([e]) },
      ]),
    );
  }
}

async function renderRecent() {
  const items = await ep.recent.list().catch(() => []);
  $recent.textContent = "";
  if (items.length === 0) {
    $recent.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "まだありません（このアプリで開いたファイルが並びます）" }));
  }
  for (const e of items) {
    $recent.append(
      row(e, () => openEntry(e), [
        { id: "open", label: "開く", run: () => openEntry(e) },
        { id: "folder", label: "ファイルの場所を開く", run: () => ep.tabs.open(chosen, { path: parentOf(e.path), replace: true }) },
      ]),
    );
  }
}

// ---- MOD（ADR 0020） ----

const SOURCE_LABEL = { user: "入れた MOD", dev: "開発中" };

function button(text, run) {
  const b = Object.assign(document.createElement("button"), { className: "tui-button", textContent: text });
  b.onclick = (e) => {
    e.stopPropagation();
    run();
  };
  return b;
}

async function renderMods() {
  const { mods, problems } = await ep.mods.list().catch(() => ({ mods: [], problems: [] }));
  $mods.textContent = "";
  const own = mods.filter((m) => m.source !== "builtin");
  if (own.length === 0 && problems.length === 0) {
    $mods.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "まだ入っていません。MOD を入れると、タブの ▸ やこのホームの「ビュー」に並びます" }));
  }
  for (const m of own) {
    const r = document.createElement("div");
    r.className = "tui-row";
    const actions = Object.assign(document.createElement("span"), { className: "mod-actions" });
    actions.append(button("フォルダ", () => ep.mods.openFolder(m.id)));
    if (m.source === "dev") actions.append(button("zip にする", () => ep.mods.pack(m.id).catch(console.warn)));
    actions.append(button(m.source === "dev" ? "読み込みをやめる" : "外す", () => ep.mods.remove(m.id).catch(() => {})));
    r.append(
      Object.assign(document.createElement("span"), { textContent: `${m.name} ${m.version}` }),
      Object.assign(document.createElement("span"), { className: `mod-source ${m.source}`, textContent: SOURCE_LABEL[m.source] || m.source }),
      Object.assign(document.createElement("span"), { className: "tui-grow tui-dim", textContent: m.description || m.id }),
      actions,
    );
    r.title = `${m.id}\n${m.dir}`;
    $mods.append(r);
  }
  // 読み込めなかった MOD は、作っている人が直せるように、理由をそのまま出す
  for (const p of problems) {
    $mods.append(Object.assign(document.createElement("div"), { className: "tui-row tui-warn problem", textContent: `読み込めません：${p.dir} — ${p.errors.join(" / ")}` }));
  }
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

ep.onMods(async () => {
  views = (await ep.views.list()).filter((v) => v.id !== "builtin.home");
  renderViews();
  await renderMods();
});

ep.onQuickAccess(renderQuick);
ep.onRecent(renderRecent);

ep.ready().then(async () => {
  views = (await ep.views.list()).filter((v) => v.id !== "builtin.home");
  const saved = await ep.storage.get("chosen").catch(() => undefined);
  if (typeof saved === "string" && views.some((v) => v.id === saved && v.location === "folder")) chosen = saved;
  renderViews();
  await Promise.all([renderQuick(), renderRecent(), renderMods()]);
});
