// 標準のビュー「タグ」（ADR 0010・0013）。左にタグの一覧、右にそのタグが付いた項目。
// 見た目は TUI 風（/__runtime/tui.css）、操作はマウスが主：クリックで選ぶ、ダブルクリックで開く、右クリックでメニュー。キーボードでも使える。
import { ask, button, confirm, pickColor, PALETTE } from "/__runtime/tui.js";

const ep = window.explorerPlus;

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.body.className = "tui";
document.body.innerHTML = `
  <div class="tui-toolbar" id="toolbar"></div>
  <div class="tui-main">
    <section class="tui-box" style="flex: 1">
      <span class="tui-box-title">タグ</span>
      <div class="tui-scroll" id="tags" tabindex="0"></div>
    </section>
    <section class="tui-box" style="flex: 2">
      <span class="tui-box-title" id="items-title">項目</span>
      <div class="tui-scroll" id="items" tabindex="0"></div>
    </section>
  </div>
  <div class="tui-message" id="message"></div>`;

const $tags = document.getElementById("tags");
const $items = document.getElementById("items");
const $itemsTitle = document.getElementById("items-title");
const $message = document.getElementById("message");

let tags = [];
let items = [];
let tagCursor = 0;
let itemCursor = 0;
let pane = "tags"; // キーボードで動かす側

const currentTag = () => tags[tagCursor] || null;

function say(text, isError = false) {
  $message.textContent = text;
  $message.classList.toggle("is-error", isError);
}

function errorText(err) {
  if (err.code === "exists") return "同じ名前のタグが既にあります。";
  if (err.code === "invalid") return "名前は1〜40文字、色は #rrggbb の形にしてください。";
  return err.message || String(err);
}

const report = (err) => err && say(errorText(err), true);

/** ビュー独自の項目だけの右クリックのメニュー（本体が描く。ADR 0013 判断2） */
async function menu(e, entries) {
  e.preventDefault();
  const { chosen } = await ep.showMenu({ x: e.clientX, y: e.clientY, items: [], extra: entries.map(({ id, label }) => ({ id, label })) });
  entries.find((m) => m.id === chosen)?.run();
}

// ---- 操作 ----

async function newTag() {
  const name = await ask({ label: "新しいタグの名前:", okLabel: "作る" });
  if (!name) return;
  try {
    const tag = await ep.tags.create(name, PALETTE[tags.length % PALETTE.length]);
    tags = await ep.tags.list();
    tagCursor = Math.max(0, tags.findIndex((x) => x.id === tag.id));
    await refresh();
  } catch (err) {
    report(err);
  }
}

async function renameTag(t) {
  const name = await ask({ label: "タグの名前:", value: t.name, okLabel: "変える" });
  if (name) ep.tags.update(t.id, { name }).catch(report);
}

async function recolorTag(t) {
  const color = await pickColor({ title: `「${t.name}」の色`, value: t.color });
  if (color) ep.tags.update(t.id, { color }).catch(report);
}

async function deleteTag(t) {
  if (await confirm({ message: `タグ「${t.name}」を消しますか？（付いていた項目からも外れます）`, okLabel: "消す" })) ep.tags.delete(t.id).catch(report);
}

function openItem(e) {
  if (e) ep.open(e, { newTab: true }).catch((err) => say(err.code === "not-found" ? "見つかりません（消されたか、別のドライブへ移されました）" : errorText(err), true));
}

// ---- 描画 ----

const toolbar = document.getElementById("toolbar");
toolbar.append(button("＋ 新しいタグ", newTag, { accent: true }));

function renderTags() {
  $tags.textContent = "";
  if (tags.length === 0) {
    $tags.innerHTML = `<div class="tui-row tui-dim">タグはまだありません。上の［＋ 新しいタグ］で作れます。</div>`;
    return;
  }
  tags.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "tui-row";
    if (i === tagCursor) row.classList.add(pane === "tags" ? "is-selected" : "is-cursor");
    const dot = Object.assign(document.createElement("span"), { className: "tui-dot" });
    dot.style.setProperty("--dot", t.color);
    row.append(dot, Object.assign(document.createElement("span"), { className: "tui-grow", textContent: t.name }));
    row.onclick = () => {
      tagCursor = i;
      pane = "tags";
      refresh();
    };
    row.ondblclick = () => renameTag(t);
    row.oncontextmenu = (e) => {
      tagCursor = i;
      refresh();
      menu(e, [
        { id: "rename", label: "名前を変える…", run: () => renameTag(t) },
        { id: "color", label: "色を変える…", run: () => recolorTag(t) },
        { id: "delete", label: "このタグを消す", run: () => deleteTag(t) },
      ]);
    };
    $tags.appendChild(row);
  });
}

function parentOf(path) {
  const i = path.lastIndexOf("\\");
  return i > 0 ? path.slice(0, i) : path;
}

function renderItems() {
  $items.textContent = "";
  const t = currentTag();
  $itemsTitle.textContent = t ? `「${t.name}」が付いた項目（${items.length}）` : "項目";
  if (!t) return;
  if (items.length === 0) {
    $items.innerHTML = `<div class="tui-row tui-dim">まだありません。ほかのビューで項目を右クリック →「タグ…」で付けられます。</div>`;
    return;
  }
  items.forEach((e, i) => {
    const row = document.createElement("div");
    row.className = "tui-row";
    if (i === itemCursor && pane === "items") row.classList.add("is-selected");
    row.append(
      Object.assign(document.createElement("span"), { className: "tui-accent", textContent: e.kind === "folder" ? "▸" : " " }),
      Object.assign(document.createElement("span"), { textContent: e.name }),
      Object.assign(document.createElement("span"), { className: "tui-grow tui-dim", textContent: parentOf(e.path) }),
    );
    row.title = e.path;
    row.onclick = () => {
      itemCursor = i;
      pane = "items";
      renderAll();
    };
    row.ondblclick = () => openItem(e);
    row.oncontextmenu = (ev) => {
      itemCursor = i;
      pane = "items";
      renderAll();
      menu(ev, [
        { id: "open", label: e.kind === "folder" ? "新しいタブで開く" : "開く", run: () => openItem(e) },
        { id: "where", label: "ファイルの場所を開く", run: () => ep.tabs.open("builtin.win11", { path: parentOf(e.path) }) },
        { id: "untag", label: `「${t.name}」を外す`, run: () => ep.tags.assign([e], t.id, false).catch(report) },
      ]);
    };
    $items.appendChild(row);
  });
}

function renderAll() {
  renderTags();
  renderItems();
}

async function loadItems() {
  const t = currentTag();
  items = t ? await ep.tags.entries(t.id).catch(() => []) : [];
  itemCursor = Math.min(itemCursor, Math.max(0, items.length - 1));
}

async function refresh() {
  await loadItems();
  renderAll();
}

// ---- キーボード（補助） ----

document.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey || ev.altKey || ev.target.tagName === "INPUT") return;
  const t = currentTag();
  const down = ev.key === "ArrowDown" || ev.key === "j";
  const up = ev.key === "ArrowUp" || ev.key === "k";
  if (pane === "tags") {
    if (down || up) {
      tagCursor = Math.max(0, Math.min(tags.length - 1, tagCursor + (down ? 1 : -1)));
      refresh();
    } else if ((ev.key === "Enter" || ev.key === "ArrowRight") && items.length) {
      pane = "items";
      renderAll();
    } else if (ev.key === "F2" && t) renameTag(t);
    else if (ev.key === "Delete" && t) deleteTag(t);
    else if (ev.key === "n") newTag();
    else return;
  } else {
    if (down || up) {
      itemCursor = Math.max(0, Math.min(items.length - 1, itemCursor + (down ? 1 : -1)));
      renderAll();
    } else if (ev.key === "Enter") openItem(items[itemCursor]);
    else if (ev.key === "ArrowLeft" || ev.key === "Escape") {
      pane = "tags";
      renderAll();
    } else if (ev.key === "Delete" && t && items[itemCursor]) ep.tags.assign([items[itemCursor]], t.id, false).catch(report);
    else return;
  }
  ev.preventDefault();
});

// タブを切り替えて戻ってきたら、キーボードの操作が届くようにする
window.addEventListener("focus", () => (pane === "tags" ? $tags : $items).focus());

// タグの一覧が変わった（ほかのビューで付けた・名前を変えた、など）ら描き直す
ep.onTags(async (next) => {
  const keep = currentTag()?.id;
  tags = next;
  const i = tags.findIndex((t) => t.id === keep);
  tagCursor = i >= 0 ? i : Math.min(tagCursor, Math.max(0, tags.length - 1));
  await refresh();
});

ep.ready().then(async () => {
  tags = await ep.tags.list();
  await refresh();
  $tags.focus();
});
