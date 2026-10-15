// 標準のビュー「Win11 風」。Windows 11 のエクスプローラの「詳細」表示と同じ形の一覧。
// MOD の手本も兼ねる：window.explorerPlus から今のフォルダを受け取り、好きなように描き、操作を本体に頼む。
const ep = window.explorerPlus;

// MOD のフォルダのファイルは、相対パスで読み込める
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./style.css", import.meta.url).href;
document.head.appendChild(css);

// 表示の切り替え（詳細／大アイコン。ADR 0014 判断6）。Win11 と同じく Ctrl+Shift+6 で詳細、Ctrl+Shift+2 で大アイコン
const bar = document.createElement("div");
bar.className = "bar";
const modeButtons = {
  details: Object.assign(document.createElement("button"), { textContent: "≡ 詳細", title: "詳細 (Ctrl+Shift+6)" }),
  large: Object.assign(document.createElement("button"), { textContent: "▦ 大アイコン", title: "大アイコン (Ctrl+Shift+2)" }),
};
for (const [m, b] of Object.entries(modeButtons)) {
  b.onclick = () => setMode(m);
  bar.appendChild(b);
}
document.body.appendChild(bar);

const list = document.createElement("div");
list.className = "list";
list.tabIndex = 0;
document.body.appendChild(list);

let mode = "details"; // "details" | "large"
const TILE_WIDTH = 124; // 大アイコンの1つ分の幅（style.css の .tile と合わせる）

// 詳細か大アイコンかは、フォルダごとに覚える（Win11 と同じ。ADR 0019）。フォルダのファイルID ごとに保存する
const modeKey = (f) => `mode:${f.id || f.path.toLowerCase()}`;
/** 覚えていないフォルダは、Win11 と同じく中身で決める：画像・動画が半分以上なら大アイコン */
const MEDIA_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "tif", "tiff", "svg", "mp4", "mov", "avi", "mkv", "wmv"]);
function guessMode(f) {
  const files = f.entries.filter((e) => e.kind === "file");
  const media = files.filter((e) => MEDIA_EXTS.has(e.ext)).length;
  return files.length > 0 && media * 2 >= files.length ? "large" : "details";
}

function setMode(m, remember = true) {
  mode = m;
  for (const [k, b] of Object.entries(modeButtons)) b.classList.toggle("on", k === mode);
  if (remember && folder) ep.storage.set(modeKey(folder), mode).catch(report);
  if (folder) render();
}

let folder = null; // 今のフォルダ（FolderSnapshot）
let rows = []; // 表示している順の Entry
let selected = new Set(); // 選んでいる Entry の path
let anchor = null; // Shift で範囲を選ぶときの起点（行の番号）
let cursor = null; // キーボードで動かす今の行（行の番号）
let sort = { key: "name", dir: 1 }; // 列の見出しで並べ替える。"name" の昇順は本体の並び順（フォルダが先・自然な順）のまま
let editing = null; // 名前を変えている最中の { path, input }
let pendingFolder = null; // 名前の変更中に届いたフォルダ（終わってから描く）

const COLUMNS = [
  { key: "name", label: "名前", width: 360 },
  { key: "modified", label: "更新日時", width: 160 },
  { key: "type", label: "種類", width: 150 },
  { key: "size", label: "サイズ", width: 100 },
];
const MIN_COLUMN_WIDTH = 48;
// 列の幅は、このビュー専用の保存場所（ep.storage）に覚えておく。どのタブで開いても同じ幅になる
let widths = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
ep.storage
  .get("columns")
  .then((saved) => {
    if (saved && typeof saved === "object") {
      for (const c of COLUMNS) if (Number.isFinite(saved[c.key])) widths[c.key] = Math.max(MIN_COLUMN_WIDTH, saved[c.key]);
      if (folder) render();
    }
  })
  .catch(report);

function formatSize(bytes) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  // Windows のエクスプローラと同じく、KB 単位で切り上げて表示する
  return `${Math.ceil(bytes / 1024).toLocaleString("ja-JP")} KB`;
}

function formatDate(ms) {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function typeLabel(e) {
  if (e.kind === "folder") return "ファイル フォルダー";
  return e.ext ? `${e.ext.toUpperCase()} ファイル` : "ファイル";
}

function report(err) {
  // ごみ箱の確認で「やめる」を選んだ（denied）ときは、何もしない
  if (err && err.code !== "denied") console.warn(err);
}

function sortedRows() {
  // 隠しファイルも出す（少し薄く。発案者の希望。Windows のシステムファイルと .explorer_plus は本体が一覧から外している）
  const visible = folder.entries;
  if (sort.key === "name") return sort.dir === 1 ? visible : [...visible].reverse();
  const value = {
    modified: (e) => e.modified ?? 0,
    type: (e) => typeLabel(e),
    size: (e) => (e.kind === "folder" ? -1 : (e.size ?? 0)),
  }[sort.key];
  // 同じ値どうしは本体の並び順を保つ（Array.prototype.sort は安定）
  return [...visible].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

// ---- 描画 ----

/** 名前の横に、付いているタグを色の点で出す（名前は点にマウスを乗せると出る） */
function appendTagDots(cell, e) {
  for (const id of e.tags || []) {
    const t = tagById.get(id);
    if (!t) continue;
    const dot = Object.assign(document.createElement("span"), { className: "tag-dot", title: t.name });
    dot.style.background = t.color;
    cell.appendChild(dot);
  }
}

/** 大アイコンの絵：ファイルは Windows の縮小画像（画像・PDF・動画など）、フォルダなどは大きいアイコン */
function bigImage(e) {
  if (e.kind === "file" && e.thumbnailUrl && e.iconKind === "system") return e.thumbnailUrl;
  return (e.iconUrl || "").replace("size=32", "size=256");
}

function renderTiles() {
  const grid = document.createElement("div");
  grid.className = "tiles";
  rows.forEach((e, i) => {
    const tile = document.createElement("div");
    tile.className = `tile item${e.hidden ? " is-hidden" : ""}`;
    tile.dataset.index = String(i);
    tile.title = e.name;
    if (selected.has(e.path)) tile.classList.add("selected");
    const img = Object.assign(document.createElement("img"), { className: "tile-img", src: bigImage(e), alt: "", loading: "lazy", decoding: "async" });
    // 縮小画像が作れないファイルは、アイコンに戻す
    img.onerror = () => {
      if (e.iconUrl && img.src !== e.iconUrl) img.src = e.iconUrl;
    };
    const cell = document.createElement("div");
    cell.className = "name-cell";
    cell.appendChild(Object.assign(document.createElement("span"), { className: "name-text", textContent: e.name }));
    appendTagDots(cell, e);
    tile.append(img, cell);
    grid.appendChild(tile);
  });
  list.appendChild(grid);
}

function render() {
  rows = sortedRows();
  list.textContent = "";
  list.classList.toggle("large", mode === "large");
  if (rows.length === 0) {
    list.appendChild(Object.assign(document.createElement("div"), { className: "empty", textContent: "このフォルダーは空です。" }));
    return;
  }
  if (mode === "large") return renderTiles();
  const table = document.createElement("table");
  const colgroup = document.createElement("colgroup");
  for (const c of COLUMNS) colgroup.appendChild(Object.assign(document.createElement("col"), { className: `col-${c.key}` })).style.width = `${widths[c.key]}px`;
  table.appendChild(colgroup);
  table.style.width = `${COLUMNS.reduce((s, c) => s + widths[c.key], 0)}px`;

  const head = table.createTHead().insertRow();
  for (const c of COLUMNS) {
    const th = document.createElement("th");
    th.className = c.key;
    th.append(Object.assign(document.createElement("span"), { textContent: c.label }));
    if (sort.key === c.key) th.append(Object.assign(document.createElement("span"), { className: "arrow", textContent: sort.dir === 1 ? "▲" : "▼" }));
    th.onclick = () => {
      sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 };
      render();
    };
    const grip = Object.assign(document.createElement("span"), { className: "resizer", title: "ドラッグで幅を変える" });
    grip.addEventListener("mousedown", (ev) => startResize(ev, c.key, table));
    grip.addEventListener("click", (ev) => ev.stopPropagation());
    th.appendChild(grip);
    head.appendChild(th);
  }
  const body = table.createTBody();
  rows.forEach((e, i) => {
    const tr = body.insertRow();
    tr.className = `item${e.hidden ? " is-hidden" : ""}`;
    tr.dataset.index = String(i);
    if (selected.has(e.path)) tr.classList.add("selected");
    const name = tr.insertCell();
    name.className = "name";
    const cell = document.createElement("div");
    cell.className = "name-cell";
    if (e.iconUrl) cell.appendChild(Object.assign(document.createElement("img"), { src: e.iconUrl, alt: "", loading: "lazy" }));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "name-text", textContent: e.name }));
    appendTagDots(cell, e);
    name.appendChild(cell);
    Object.assign(tr.insertCell(), { className: "modified", textContent: formatDate(e.modified) });
    Object.assign(tr.insertCell(), { className: "type", textContent: typeLabel(e) });
    Object.assign(tr.insertCell(), { className: "size", textContent: e.kind === "file" ? formatSize(e.size) : "" });
  });
  list.appendChild(table);
}

// ---- 列の幅 ----

function startResize(ev, key, table) {
  ev.preventDefault();
  ev.stopPropagation();
  const startX = ev.clientX;
  const startWidth = widths[key];
  const col = table.querySelector(`col.col-${key}`);
  document.body.classList.add("resizing");
  const onMove = (e) => {
    widths[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + e.clientX - startX));
    col.style.width = `${widths[key]}px`;
    table.style.width = `${COLUMNS.reduce((s, c) => s + widths[c.key], 0)}px`;
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("resizing");
    ep.storage.set("columns", widths).catch(report);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// ---- 選択 ----

// 詳細の行（tr.item）と大アイコンの1つ（div.item）は、どちらも data-index で行の番号を持つ
function rowElement(i) {
  return list.querySelector(`.item[data-index="${i}"]`);
}

function paintSelection() {
  for (const el of list.querySelectorAll(".item")) el.classList.toggle("selected", selected.has(rows[Number(el.dataset.index)].path));
}

function select(i, { ctrl = false, shift = false } = {}) {
  cursor = i;
  if (shift && anchor !== null) {
    const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
    if (!ctrl) selected.clear();
    for (let k = a; k <= b; k++) selected.add(rows[k].path);
  } else if (ctrl) {
    const p = rows[i].path;
    selected.has(p) ? selected.delete(p) : selected.add(p);
    anchor = i;
  } else {
    selected = new Set([rows[i].path]);
    anchor = i;
  }
  paintSelection();
  rowElement(i)?.scrollIntoView({ block: "nearest" });
}

const selectedEntries = () => rows.filter((e) => selected.has(e.path));
const rectOf = (i) => rowElement(i)?.querySelector(".name-cell")?.getBoundingClientRect();

function openAt(i) {
  ep.open(rows[i], { from: rectOf(i) }).catch(report);
}

// ---- 名前の変更（F2・メニュー・新しいフォルダーの直後） ----

const RENAME_ERRORS = {
  invalid: "この名前は使えません。次の文字は使えません：\\ / : * ? \" < > |（CON などの名前や、末尾の空白・ピリオドも使えません）",
  exists: "同じ名前のファイルまたはフォルダーが既にあります。",
};

function beginRename(path) {
  finishRename(false);
  const i = rows.findIndex((e) => e.path === path);
  if (i < 0) return;
  select(i);
  const entry = rows[i];
  const span = rowElement(i).querySelector(".name-text");
  const input = Object.assign(document.createElement("input"), { className: "rename", value: entry.name, spellcheck: false });
  span.replaceWith(input);
  input.focus();
  // ファイルは拡張子の前までを選ぶ（Windows と同じ）
  const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
  input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  editing = { entry, input, busy: false };
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") finishRename(true);
    else if (ev.key === "Escape") finishRename(false);
  });
  input.addEventListener("blur", () => finishRename(true));
  input.addEventListener("mousedown", (ev) => ev.stopPropagation());
}

function showRenameError(input, message) {
  input.parentElement.querySelector(".rename-error")?.remove();
  input.insertAdjacentElement("afterend", Object.assign(document.createElement("div"), { className: "rename-error", textContent: message }));
}

function finishRename(commit) {
  if (!editing || editing.busy) return;
  const { entry, input } = editing;
  const newName = input.value;
  const done = (selectPath) => {
    editing = null;
    if (pendingFolder) {
      folder = pendingFolder;
      pendingFolder = null;
    }
    if (selectPath) selected = new Set([selectPath]);
    render();
    const i = rows.findIndex((e) => selected.has(e.path));
    if (i >= 0) cursor = anchor = i;
    list.focus();
  };
  if (!commit || newName === entry.name || newName.trim() === "") {
    done(null);
    return;
  }
  editing.busy = true;
  ep.rename(entry, newName).then(
    (renamed) => done(renamed.path),
    (err) => {
      editing.busy = false;
      showRenameError(input, RENAME_ERRORS[err.code] || err.message);
      input.focus();
    },
  );
}

// ---- 右クリックのメニュー（本体が描く） ----

function openMenu(x, y) {
  ep.showMenu({ x, y, items: selectedEntries() }).catch(report);
}

list.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  const tr = ev.target.closest(".item");
  if (tr) {
    const i = Number(tr.dataset.index);
    if (!selected.has(rows[i].path)) select(i);
  } else if (!ev.target.closest("thead")) {
    selected.clear();
    paintSelection();
  }
  openMenu(ev.clientX, ev.clientY);
});

// ---- マウスとキーボード ----

// マウスで押して動かす（ADR 0015 判断2・ADR 0033）。Win11 と同じく：
// - 名前（大アイコンでは項目そのもの）をつかんで動かす：ドラッグ＆ドロップ。そこから先は本体が受け持つ
// - 空いている所、詳細表示の名前以外の列から動かす：薄い青の四角で囲んで選ぶ（Ctrl で切り替え、Shift で足す）。端に来ると流れる
let pressed = null; // { x, y, index（空いている所なら null）, deferSelect, marquee, ctrl, shift, pointerId }
const DRAG_START_PX = 6;

list.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || editing) return;
  if (ev.target.closest("thead")) return;
  // スクロールバーの上は、ふつうにスクロールさせる
  const lr = list.getBoundingClientRect();
  if (ev.clientX - lr.left >= list.clientWidth || ev.clientY - lr.top >= list.clientHeight) return;
  const item = ev.target.closest(".item");
  const mods = { ctrl: ev.ctrlKey, shift: ev.shiftKey };
  if (!item) {
    if (!ev.ctrlKey && !ev.shiftKey) {
      selected.clear();
      paintSelection();
    }
    pressed = { x: ev.clientX, y: ev.clientY, index: null, deferSelect: false, marquee: true, ...mods, pointerId: ev.pointerId };
    return;
  }
  const i = Number(item.dataset.index);
  const onName = mode === "large" || !!ev.target.closest(".name-cell");
  if (!onName) {
    // 名前以外の列：離したときに選ぶ（動かしたら、四角で選ぶ）
    pressed = { x: ev.clientX, y: ev.clientY, index: i, deferSelect: true, marquee: true, ...mods, pointerId: ev.pointerId };
    return;
  }
  // すでに選んでいる項目を押したときは、離すまで選び直さない（複数選んだままドラッグできるように。Win11 と同じ）
  const deferSelect = selected.has(rows[i].path) && !ev.ctrlKey && !ev.shiftKey;
  if (!deferSelect) select(i, mods);
  pressed = { x: ev.clientX, y: ev.clientY, index: i, deferSelect, marquee: false, ctrl: false, shift: false, pointerId: ev.pointerId };
});

list.addEventListener("pointermove", (ev) => {
  if (marquee) {
    marquee.last = { x: ev.clientX, y: ev.clientY };
    return;
  }
  if (!pressed || editing) return;
  if (!(ev.buttons & 1)) {
    pressed = null;
    return;
  }
  if (Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) < DRAG_START_PX) return;
  if (pressed.marquee) {
    startMarquee(pressed, ev);
    pressed = null;
    return;
  }
  const items = selectedEntries();
  pressed = null;
  if (items.length > 0) ep.drag.start({ items, x: ev.clientX, y: ev.clientY, targets: dropTargets() }).catch(report);
});

const endPress = (ev) => {
  if (marquee) return endMarquee();
  if (pressed?.deferSelect && ev.type === "pointerup") select(pressed.index, pressed.marquee ? { ctrl: pressed.ctrl, shift: pressed.shift } : {});
  pressed = null;
};
list.addEventListener("pointerup", endPress);
list.addEventListener("pointercancel", endPress);

// ---- 四角で囲んで選ぶ ----

let marquee = null; // { x0, y0（一覧の中の位置）, base（始めたときの選択）, toggle, el, last（画面の位置）, raf }
const EDGE_PX = 28;

/** 画面の位置を、一覧の中の位置（スクロールを含む）にする */
function contentPoint(cx, cy) {
  const r = list.getBoundingClientRect();
  return { x: cx - r.left + list.scrollLeft, y: cy - r.top + list.scrollTop };
}

function startMarquee(p, ev) {
  list.setPointerCapture(p.pointerId);
  const s = contentPoint(p.x, p.y);
  const el = Object.assign(document.createElement("div"), { className: "marquee" });
  list.appendChild(el);
  marquee = { x0: s.x, y0: s.y, base: new Set(p.ctrl || p.shift ? selected : []), toggle: p.ctrl, el, last: { x: ev.clientX, y: ev.clientY }, raf: 0 };
  tickMarquee();
}

/** 1コマごと：端に近ければ流し、四角に入っている項目を選び直す */
function tickMarquee() {
  const m = marquee;
  if (!m) return;
  const r = list.getBoundingClientRect();
  const { x: cx, y: cy } = m.last;
  const speed = (d) => Math.ceil(Math.min(d, 120) / 4);
  if (cy < r.top + EDGE_PX) list.scrollTop -= speed(r.top + EDGE_PX - cy);
  else if (cy > r.bottom - EDGE_PX) list.scrollTop += speed(cy - (r.bottom - EDGE_PX));
  if (cx < r.left + EDGE_PX) list.scrollLeft -= speed(r.left + EDGE_PX - cx);
  else if (cx > r.right - EDGE_PX) list.scrollLeft += speed(cx - (r.right - EDGE_PX));
  const p = contentPoint(cx, cy);
  const px = Math.max(0, Math.min(p.x, list.scrollWidth));
  const py = Math.max(0, Math.min(p.y, list.scrollHeight));
  const x = Math.min(px, m.x0);
  const y = Math.min(py, m.y0);
  const w = Math.abs(px - m.x0);
  const h = Math.abs(py - m.y0);
  Object.assign(m.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  const next = new Set(m.base);
  for (const it of list.querySelectorAll(".item")) {
    const b = it.getBoundingClientRect();
    const ix = b.left - r.left + list.scrollLeft;
    const iy = b.top - r.top + list.scrollTop;
    if (ix < x + w && ix + b.width > x && iy < y + h && iy + b.height > y) {
      const path = rows[Number(it.dataset.index)].path;
      if (m.toggle && m.base.has(path)) next.delete(path);
      else next.add(path);
    }
  }
  if (next.size !== selected.size || [...next].some((k) => !selected.has(k))) {
    selected = next;
    paintSelection();
  }
  m.raf = requestAnimationFrame(tickMarquee);
}

function endMarquee() {
  if (!marquee) return;
  cancelAnimationFrame(marquee.raf);
  marquee.el.remove();
  marquee = null;
  // 次に Shift で選ぶときの起点は、選んだものの最初
  const first = rows.findIndex((e) => selected.has(e.path));
  anchor = cursor = first >= 0 ? first : null;
}

/** このビューの中の、落とせる場所（見えているフォルダの行・アイコン。選んでいるものは除く） */
function dropTargets() {
  const out = [];
  for (const el of list.querySelectorAll(".item")) {
    const e = rows[Number(el.dataset.index)];
    if (e.kind !== "folder" || selected.has(e.path)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    out.push({ entry: e, rect: r });
    if (out.length >= 500) break;
  }
  return out;
}

// ドラッグ中にこのタブへ切り替わったら、落とせる場所を知らせ直す
ep.onDragTargets(() => ep.drag.targets(dropTargets()).catch(report));

list.addEventListener("dblclick", (ev) => {
  const tr = ev.target.closest(".item");
  if (tr && !editing) openAt(Number(tr.dataset.index));
});

/** キーの判定。キーの位置（code）と文字（key）のどちらでも見る（入力の方法によって code が空のことがあるため） */
const keyIs = (ev, letter) => ev.code === `Key${letter.toUpperCase()}` || ev.key.toLowerCase() === letter;

list.addEventListener("keydown", (ev) => {
  if (editing) return;
  // 貼り付けは、空のフォルダでもできるように先に見る
  if (ev.ctrlKey && !ev.shiftKey && keyIs(ev, "v")) {
    ev.preventDefault();
    ep.clipboard.paste().catch(report);
    return;
  }
  if (rows.length === 0) return;
  const current = cursor ?? -1;
  // 大アイコンでは、上下は1段（横に並んでいる数）ずつ、左右は1つずつ動く
  const perRow = mode === "large" ? Math.max(1, Math.floor((list.clientWidth - 16) / TILE_WIDTH)) : 1;
  const step = { ArrowDown: perRow, ArrowUp: -perRow, ...(mode === "large" ? { ArrowRight: 1, ArrowLeft: -1 } : {}) }[ev.key];
  if (ev.ctrlKey && ev.shiftKey && (ev.code === "Digit6" || ev.code === "Digit2")) {
    ev.preventDefault();
    setMode(ev.code === "Digit2" ? "large" : "details");
  } else if (step !== undefined) {
    ev.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, current + step));
    select(next, { shift: ev.shiftKey });
  } else if (ev.key === "Home" || ev.key === "End") {
    ev.preventDefault();
    select(ev.key === "Home" ? 0 : rows.length - 1, { shift: ev.shiftKey });
  } else if (ev.key === "Enter" && current >= 0) {
    ev.preventDefault();
    openAt(current);
  } else if (ev.key === "F2" && current >= 0) {
    ev.preventDefault();
    beginRename(rows[current].path);
  } else if (ev.key === "Delete") {
    const items = selectedEntries();
    if (items.length > 0) ep.trash(items, { from: rectOf(current) }).catch(report);
  } else if (ev.key === "Backspace") {
    ep.navigateUp().catch(report);
  } else if (ev.ctrlKey && !ev.shiftKey && (keyIs(ev, "c") || keyIs(ev, "x"))) {
    // 切り取り・コピー（ADR 0015 判断1）。Windows のエクスプローラにも貼り付けられる
    ev.preventDefault();
    const items = selectedEntries();
    if (items.length > 0) (keyIs(ev, "x") ? ep.clipboard.cut(items) : ep.clipboard.copy(items)).catch(report);
  } else if (ev.key === "a" && ev.ctrlKey) {
    ev.preventDefault();
    selected = new Set(rows.map((e) => e.path));
    paintSelection();
  } else if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
    // メニューキー・Shift+F10：今の行の位置にメニューを出す
    ev.preventDefault();
    const r = current >= 0 ? rectOf(current) : null;
    openMenu(r ? r.x + 24 : 40, r ? r.bottom : 40);
  }
});

// タグの色と名前（Entry には id だけが入るので、ここで引けるようにしておく）
let tagById = new Map();
const setTags = (list) => (tagById = new Map(list.map((t) => [t.id, t])));
ep.tags.list().then((list) => {
  setTags(list);
  if (folder && !editing) render();
}, report);
ep.onTags(setTags); // この直後に、本体が今のフォルダを送り直してくるので、そこで描き直される

// タブを切り替えてこのビューに戻ってきたら、キーボードの操作が一覧に届くようにする
window.addEventListener("focus", () => {
  if (!editing) list.focus();
});

ep.onAction(({ action, entry }) => {
  if (action === "rename") beginRename(entry.path);
});

ep.onFolder((f) => {
  if (editing) {
    // 名前の入力中は描き直さない（入力欄が消えるため）。終わってから描く
    pendingFolder = f;
    return;
  }
  // 別のフォルダに移ったら、選択と並べ替えを元に戻す。同じフォルダの更新（大きさが届いた、など）なら保つ
  const moved = !folder || folder.path !== f.path;
  folder = f;
  if (moved) {
    selected.clear();
    anchor = null;
    cursor = null;
    list.scrollTop = 0;
    // まず中身から決めて描き、覚えていたものがあれば、届いたところで切り替える
    setMode(guessMode(f), false);
    ep.storage
      .get(modeKey(f))
      .then((saved) => {
        if (folder === f && (saved === "large" || saved === "details") && saved !== mode) setMode(saved, false);
      })
      .catch(report);
  } else {
    const paths = new Set(f.entries.map((e) => e.path));
    selected = new Set([...selected].filter((p) => paths.has(p)));
  }
  render();
  const i = rows.findIndex((e) => selected.has(e.path));
  cursor = i >= 0 ? i : cursor !== null && cursor < rows.length ? cursor : null;
  list.focus();
});
