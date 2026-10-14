// 標準のビュー「タグ」（ADR 0010・0011）。左にタグの一覧、右にそのタグが付いた項目。キーボードだけで操作できる。
// 見た目は本体が配る TUI 風の部品（/__runtime/tui.css）を使う。
const ep = window.explorerPlus;

const PALETTE = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.body.className = "tui";
document.body.innerHTML = `
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
  <div class="tui-message" id="message"></div>
  <footer class="tui-footer" id="keys"></footer>`;

const $tags = document.getElementById("tags");
const $items = document.getElementById("items");
const $itemsTitle = document.getElementById("items-title");
const $message = document.getElementById("message");
const $keys = document.getElementById("keys");

let tags = [];
let items = [];
let tagCursor = 0;
let itemCursor = 0;
let pane = "tags"; // "tags" | "items"
let prompt = null; // 入力中なら { input, onDone }
let confirming = null; // 「y で実行」の待ち

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

// ---- 描画 ----

function renderKeys() {
  const k = (key, label) => `<span><span class="tui-key">${key}</span>${label}</span>`;
  $keys.innerHTML =
    pane === "tags"
      ? [k("j/k", "移動"), k("Enter", "項目へ"), k("n", "新しいタグ"), k("r", "名前"), k("c", "色を変える"), k("C", "色を入力"), k("d", "消す")].join("")
      : [k("j/k", "移動"), k("Enter", "開く"), k("x", "このタグを外す"), k("h", "タグへ戻る")].join("");
}

function renderTags() {
  $tags.textContent = "";
  if (tags.length === 0) {
    $tags.innerHTML = `<div class="tui-row tui-dim">タグはまだありません。<span class="tui-key">n</span>で作れます。</div>`;
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
    $tags.appendChild(row);
  });
  $tags.children[tagCursor]?.scrollIntoView({ block: "nearest" });
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
    row.onclick = () => {
      itemCursor = i;
      pane = "items";
      renderAll();
    };
    row.ondblclick = () => openItem(i);
    $items.appendChild(row);
  });
  $items.children[itemCursor]?.scrollIntoView({ block: "nearest" });
}

function renderAll() {
  renderTags();
  renderItems();
  renderKeys();
  (pane === "tags" ? $tags : $items).focus();
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

// ---- 入力（名前・色） ----

function ask(label, initial, onDone) {
  say("");
  $message.textContent = `${label} `;
  const input = Object.assign(document.createElement("input"), { className: "tui-input", value: initial, spellcheck: false });
  input.style.width = "30ch";
  $message.appendChild(input);
  prompt = { input };
  input.focus();
  input.select();
  input.onkeydown = async (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") {
      prompt = null;
      say("");
      renderAll();
    } else if (ev.key === "Enter") {
      try {
        await onDone(input.value);
        prompt = null;
        say("");
        renderAll();
      } catch (err) {
        say(`${label} ${input.value} … ${errorText(err)}`, true);
        prompt = null;
        renderAll();
      }
    }
  };
}

// ---- 操作 ----

function openItem(i) {
  const e = items[i];
  if (e) ep.open(e, { newTab: true }).catch((err) => say(err.code === "not-found" ? "見つかりません（消されたか、別のドライブへ移されました）" : errorText(err), true));
}

function onTagsKey(ev) {
  const t = currentTag();
  switch (ev.key) {
    case "j":
    case "ArrowDown":
      tagCursor = Math.min(tags.length - 1, tagCursor + 1);
      return refresh();
    case "k":
    case "ArrowUp":
      tagCursor = Math.max(0, tagCursor - 1);
      return refresh();
    case "Enter":
    case "l":
    case "ArrowRight":
      if (items.length > 0) {
        pane = "items";
        renderAll();
      }
      return;
    case "n":
      ev.preventDefault();
      return ask("新しいタグの名前:", "", async (name) => {
        const tag = await ep.tags.create(name, PALETTE[tags.length % PALETTE.length]);
        tags = await ep.tags.list();
        tagCursor = Math.max(0, tags.findIndex((x) => x.id === tag.id));
        await loadItems();
      });
    case "r":
      ev.preventDefault();
      if (t) ask("名前:", t.name, (name) => ep.tags.update(t.id, { name }));
      return;
    case "c":
      if (t) ep.tags.update(t.id, { color: PALETTE[(PALETTE.indexOf(t.color) + 1) % PALETTE.length] }).catch((e) => say(errorText(e), true));
      return;
    case "C":
      ev.preventDefault();
      if (t) ask("色（#rrggbb）:", t.color, (color) => ep.tags.update(t.id, { color }));
      return;
    case "d":
      if (!t) return;
      confirming = () => ep.tags.delete(t.id);
      say(`タグ「${t.name}」を消しますか？（付いていた項目からも外れます）  y で消す / ほかのキーでやめる`);
      return;
  }
}

function onItemsKey(ev) {
  const t = currentTag();
  switch (ev.key) {
    case "j":
    case "ArrowDown":
      itemCursor = Math.min(items.length - 1, itemCursor + 1);
      return renderAll();
    case "k":
    case "ArrowUp":
      itemCursor = Math.max(0, itemCursor - 1);
      return renderAll();
    case "Enter":
      return openItem(itemCursor);
    case "x":
      if (t && items[itemCursor]) ep.tags.assign([items[itemCursor]], t.id, false).catch((e) => say(errorText(e), true));
      return;
    case "h":
    case "ArrowLeft":
    case "Escape":
      pane = "tags";
      return renderAll();
  }
}

document.addEventListener("keydown", (ev) => {
  if (prompt || ev.ctrlKey || ev.altKey) return;
  if (confirming) {
    const run = confirming;
    confirming = null;
    say("");
    if (ev.key === "y") run().catch((e) => say(errorText(e), true));
    return;
  }
  (pane === "tags" ? onTagsKey : onItemsKey)(ev);
});

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
});
