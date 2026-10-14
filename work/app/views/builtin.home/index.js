// 標準のビュー「ホーム」（ADR 0014 判断2）。新しいタブで開く。
// 上でビューを選び、クイックアクセスや最近使った項目を押すと、そのビューでこのタブに開く（Win11 のホームと同じく、このタブが置き換わる）。
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
  </div>`;

const $views = document.getElementById("views");
const $quick = document.getElementById("quick");
const $recent = document.getElementById("recent");

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

ep.onQuickAccess(renderQuick);
ep.onRecent(renderRecent);

ep.ready().then(async () => {
  views = (await ep.views.list()).filter((v) => v.id !== "builtin.home");
  const saved = await ep.storage.get("chosen").catch(() => undefined);
  if (typeof saved === "string" && views.some((v) => v.id === saved && v.location === "folder")) chosen = saved;
  renderViews();
  await Promise.all([renderQuick(), renderRecent()]);
});
