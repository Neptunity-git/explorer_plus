// 標準のビュー「ノート」（ADR 0019。ADR 0014 判断4 を置き換え）。フォルダごとに1枚の、自由に置ける平面。
// - 付箋：空いている所をダブルクリックで作る。中身は Markdown（書いている行だけ記号が出る）
// - 子フォルダ：アイコン付きで平面に出てくる。好きな所へ動かせる。ダブルクリックでズームインして、そのフォルダのノートへ
// - 描く：矢印・線（付箋やフォルダにつなぐと、動かしてもついてくる）・ペン・四角・丸。色も選べる
// - 拡大・縮小：Ctrl+ホイール、上の [−] [＋]、Ctrl+0 で 100%
// 保存はそのフォルダの中（ep.folderData → .explorer_plus/view.builtin.notes.json。ADR 0022）。OneDrive などで同期すれば、
// 別の PC でも同じノートが出る。名前変更・移動しても、フォルダについていく。
import { createMdEditor } from "./md-editor.js";

const ep = window.explorerPlus;

const SAVE_DELAY_MS = 500;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const HISTORY_MAX = 100;
/** ファイルのカードは、置く数に上限を付ける（大きなフォルダで画面が重くならないように） */
const FILES_MAX = 500;
const FOLDER_W = 112;
const FOLDER_H = 96;
const GRID_COLS = 6;
const GRID_X = 132;
const GRID_Y = 116;
/** "fg" は文字の色（明るい・暗い画面で変わる） */
const COLORS = ["fg", "#e5534b", "#d18616", "#57ab5a", "#539bf5", "#b083f0"];
const TOOLS = [
  { id: "select", label: "選ぶ", key: "v" },
  { id: "text", label: "付箋", key: "t" },
  { id: "arrow", label: "矢印", key: "a" },
  { id: "line", label: "線", key: "l" },
  { id: "pen", label: "ペン", key: "p" },
  { id: "rect", label: "四角", key: "r" },
  { id: "ellipse", label: "丸", key: "o" },
];

document.head.append(
  Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }),
  Object.assign(document.createElement("link"), { rel: "stylesheet", href: "./style.css" }),
);
document.body.className = "tui";
document.body.innerHTML = `
  <div class="bar" id="bar"><span class="title" id="title">ノート</span></div>
  <div class="stage" id="stage" tabindex="0">
    <div class="world" id="world"><svg class="shapes" id="shapes"></svg></div>
    <div class="hint" id="hint" hidden>空いている所をダブルクリックすると付箋を置けます<br>上の道具で矢印・線・ペン・四角・丸を描けます</div>
  </div>
  <div class="tui-message" id="message"></div>`;

const $ = (id) => document.getElementById(id);
const $bar = $("bar");
const $stage = $("stage");
const $world = $("world");
const $shapes = $("shapes");
const $title = $("title");
const $hint = $("hint");
const $message = $("message");
const SVG = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- 状態

/** 今のフォルダ */
let folder = null;
let key = null;
/** 平面の中身：{ cards: [...], shapes: [...] }。cam は見ている位置と倍率 */
let doc = { cards: [], shapes: [] };
let cam = { x: 40, y: 40, z: 1 };
let tool = "select";
let color = "fg";
const selected = new Set();
let editing = null; // { id, editor }
const editors = new Map(); // 付箋の id → エディタ
let undoStack = [];
let redoStack = [];
let saveTimer = null;
let dirty = false;
/** 右クリックで作ったフォルダを、その場所に置くため */
let pendingPlace = null;

const uid = () => Math.random().toString(36).slice(2, 10);
const cardOf = (id) => doc.cards.find((c) => c.id === id);
const shapeOf = (id) => doc.shapes.find((s) => s.id === id);
const colorValue = (c) => (c === "fg" || !c ? "var(--tui-fg)" : c);

function say(text, error = false) {
  $message.textContent = text;
  $message.classList.toggle("is-error", error);
}

// ---------------------------------------------------------------- 保存・やり直し

/** 今のフォルダの印（同じフォルダの読み直しかを見分ける）。以前はこの名前で、このビューの保存場所に置いていた */
const keyOf = (f) => `canvas:${f.id || f.path.toLowerCase()}`;
/** もっと前の形（1ページの文章）の保存場所のキー */
const oldKeyOf = (f) => `note:${f.id || f.path.toLowerCase()}`;

function changed() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !key) return;
  dirty = false;
  try {
    await ep.folderData.set(folder, { v: 1, cards: doc.cards, shapes: doc.shapes, cam });
  } catch (err) {
    dirty = true;
    say(err.code === "too-large" ? "ノートが大きすぎて保存できません（1MB まで。ペンの線を減らしてください）" : `保存できませんでした：${err.message}`, true);
  }
}

/** 変える前に呼ぶ（Ctrl+Z で戻せるように） */
function remember() {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack = [];
}

function undo(redo = false) {
  const from = redo ? redoStack : undoStack;
  const to = redo ? undoStack : redoStack;
  const prev = from.pop();
  if (!prev) return;
  to.push(JSON.stringify(doc));
  stopEditing();
  doc = JSON.parse(prev);
  selected.clear();
  renderAll();
  changed();
}

// ---------------------------------------------------------------- 見ている位置（カメラ）

function applyCam() {
  $world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  // 背景の点も、平面と一緒に動く・大きさが変わる
  $stage.style.backgroundSize = `${24 * cam.z}px ${24 * cam.z}px`;
  $stage.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  $zoomLabel.textContent = `${Math.round(cam.z * 100)}%`;
}

/** 画面の点 → 平面の点 */
function toWorld(clientX, clientY) {
  const r = $stage.getBoundingClientRect();
  return { x: (clientX - r.left - cam.x) / cam.z, y: (clientY - r.top - cam.y) / cam.z };
}

/** 画面の点 (sx, sy)（stage の中の座標）を動かさずに、倍率を z にする */
function zoomAt(z, sx, sy) {
  z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  cam = { x: sx - ((sx - cam.x) / cam.z) * z, y: sy - ((sy - cam.y) / cam.z) * z, z };
  applyCam();
  changed();
}

function zoomCenter(factor) {
  const r = $stage.getBoundingClientRect();
  zoomAt(cam.z * factor, r.width / 2, r.height / 2);
}

/** 中身の全体が入る位置と倍率 */
function fitCam() {
  const boxes = [...doc.cards.map(cardRect), ...doc.shapes.map(shapeBox).filter(Boolean)];
  const r = $stage.getBoundingClientRect();
  if (boxes.length === 0) return { x: 40, y: 40, z: 1 };
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 40;
  const z = Math.min(1, Math.max(ZOOM_MIN, Math.min((r.width - pad * 2) / (x2 - x1 || 1), (r.height - pad * 2) / (y2 - y1 || 1))));
  return { x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z, z };
}

/** カードが画面いっぱいより少し大きく見える位置（フォルダに入る・出るときのズームの先） */
function focusCam(card) {
  const r = $stage.getBoundingClientRect();
  const b = cardRect(card);
  const z = Math.min(16, (r.width * 1.3) / b.w);
  return { x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z, z };
}

let animFrame = null;
/** カメラと濃さを、なめらかに動かす（倍率は掛け算の目盛りで動かすと自然に見える） */
function animate(from, to, opFrom, opTo, ms) {
  if (animFrame) cancelAnimationFrame(animFrame);
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
      // 倍率が変わっても、真ん中の点がまっすぐ動くように、平面上の中心で補う
      const r = $stage.getBoundingClientRect();
      const cx0 = (r.width / 2 - from.x) / from.z;
      const cy0 = (r.height / 2 - from.y) / from.z;
      const cx1 = (r.width / 2 - to.x) / to.z;
      const cy1 = (r.height / 2 - to.y) / to.z;
      const cx = cx0 + (cx1 - cx0) * e;
      const cy = cy0 + (cy1 - cy0) * e;
      $world.style.transform = `translate(${r.width / 2 - cx * z}px, ${r.height / 2 - cy * z}px) scale(${z})`;
      $world.style.opacity = String(opFrom + (opTo - opFrom) * e);
      if (t < 1) animFrame = requestAnimationFrame(step);
      else {
        animFrame = null;
        resolve();
      }
    };
    animFrame = requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- 形と位置

/** フォルダ・ファイルのカード（実際の項目を映したもの。付箋とちがい、ここでは消さない） */
const isEntry = (c) => c.kind === "folder" || c.kind === "file";

function cardRect(c) {
  if (isEntry(c)) {
    const el = $world.querySelector(`[data-id="${c.id}"]`);
    return { x: c.x, y: c.y, w: FOLDER_W, h: el ? el.offsetHeight : FOLDER_H };
  }
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

/** 線の端：カードにつながっていれば、もう一方の端へ向かう線とカードの枠の交わる所 */
function endPoint(end, toward) {
  if (!end.card) return { x: end.x, y: end.y };
  const c = cardOf(end.card);
  if (!c) return { x: end.x ?? 0, y: end.y ?? 0 };
  const b = cardRect(c);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(Math.abs((b.w / 2 + 6) / (dx || 1e-9)), Math.abs((b.h / 2 + 6) / (dy || 1e-9)));
  return { x: cx + dx * Math.min(1, s), y: cy + dy * Math.min(1, s) };
}

function centerOf(end) {
  if (!end.card) return { x: end.x, y: end.y };
  const c = cardOf(end.card);
  if (!c) return { x: end.x ?? 0, y: end.y ?? 0 };
  const b = cardRect(c);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function lineEnds(s) {
  const a = endPoint(s.a, centerOf(s.b));
  const b = endPoint(s.b, centerOf(s.a));
  return [a, b];
}

function shapeBox(s) {
  let pts;
  if (s.kind === "arrow" || s.kind === "line") pts = lineEnds(s);
  else if (s.kind === "pen") pts = s.points.map(([x, y]) => ({ x, y }));
  else pts = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }];
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 新しいフォルダを置く、空いている場所（ほかのカードと重ならない、格子の目） */
function freeSlot(boxes = doc.cards.map(cardRect)) {
  for (let i = 0; i < 4000; i++) {
    const x = (i % GRID_COLS) * GRID_X;
    const y = Math.floor(i / GRID_COLS) * GRID_Y;
    const hit = boxes.some((b) => x < b.x + b.w + 8 && x + FOLDER_W + 8 > b.x && y < b.y + b.h + 8 && y + FOLDER_H + 8 > b.y);
    if (!hit) {
      boxes.push({ x, y, w: FOLDER_W, h: FOLDER_H });
      return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

// ---------------------------------------------------------------- 描く

function renderAll() {
  for (const el of [...$world.querySelectorAll(".card")]) {
    if (!cardOf(el.dataset.id)) {
      editors.get(el.dataset.id)?.destroy();
      editors.delete(el.dataset.id);
      el.remove();
    }
  }
  for (const c of doc.cards) renderCard(c);
  renderShapes();
  $hint.hidden = doc.cards.length > 0 || doc.shapes.length > 0;
}

function renderCard(c) {
  let el = $world.querySelector(`.card[data-id="${c.id}"]`);
  if (!el) {
    el = document.createElement("div");
    el.dataset.id = c.id;
    el.className = `card ${c.kind}`;
    if (c.kind === "text") {
      const host = Object.assign(document.createElement("div"), { className: "cm-host" });
      el.append(host, Object.assign(document.createElement("div"), { className: "grip" }));
      const editor = createMdEditor(host, {
        text: c.text || "",
        onChange: (text) => {
          const card = cardOf(c.id);
          if (card) {
            card.text = text;
            changed();
          }
        },
      });
      editors.set(c.id, editor);
    } else {
      el.append(Object.assign(document.createElement("img"), { alt: "" }), Object.assign(document.createElement("span"), { className: "name" }));
    }
    $world.appendChild(el);
  }
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y}px`;
  if (c.kind === "text") {
    el.style.width = `${c.w}px`;
    el.style.height = `${c.h}px`;
    el.style.setProperty("--cc", c.color && c.color !== "fg" ? c.color : "");
    editors.get(c.id)?.setText(c.text || "");
  } else {
    const entry = folder?.entries.find((e) => e.id ? e.id === c.fid : e.path === c.path);
    // 画像・動画などは、Windows の縮小画像を出す
    el.querySelector("img").src = (c.kind === "file" && entry?.iconKind === "system" && entry.thumbnailUrl) || entry?.iconUrl || "";
    el.classList.toggle("is-hidden", !!entry?.hidden);
    el.title = c.name;
    const name = el.querySelector(".name");
    if (name) name.textContent = c.name;

  }
  el.classList.toggle("is-selected", selected.has(c.id));
}

function svg(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 形の線（見える線）の d と、矢印の先の三角 */
function shapePaths(s) {
  if (s.kind === "arrow" || s.kind === "line") {
    const [a, b] = lineEnds(s);
    let d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
    let head = null;
    if (s.kind === "arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = 12 + (s.width || 2) * 2;
      const p1 = { x: b.x - len * Math.cos(ang - 0.45), y: b.y - len * Math.sin(ang - 0.45) };
      const p2 = { x: b.x - len * Math.cos(ang + 0.45), y: b.y - len * Math.sin(ang + 0.45) };
      head = `M${b.x} ${b.y}L${p1.x} ${p1.y}L${p2.x} ${p2.y}Z`;
    }
    return { d, head };
  }
  if (s.kind === "pen") {
    const p = s.points;
    return { d: p.length ? `M${p[0][0]} ${p[0][1]}` + p.slice(1).map(([x, y]) => `L${x} ${y}`).join("") : "", head: null };
  }
  if (s.kind === "rect") return { d: `M${s.x} ${s.y}h${s.w}v${s.h}h${-s.w}Z`, head: null };
  const rx = s.w / 2;
  const ry = s.h / 2;
  const cx = s.x + rx;
  const cy = s.y + ry;
  return { d: `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`, head: null };
}

function renderShapes() {
  $shapes.textContent = "";
  for (const s of doc.shapes) $shapes.appendChild(shapeElement(s));
}

function shapeElement(s, preview = false) {
  const g = svg("g", { "data-id": s.id });
  const { d, head } = shapePaths(s);
  const c = colorValue(s.color);
  const w = s.width || 2;
  const line = svg("path", { d, fill: "none", stroke: c, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" });
  g.appendChild(line);
  if (head) g.appendChild(svg("path", { d: head, fill: c, stroke: c, "stroke-width": 1, "stroke-linejoin": "round" }));
  if (!preview) g.appendChild(svg("path", { d, class: "hit", "stroke-width": Math.max(12, 12 / cam.z) }));
  if (selected.has(s.id)) g.classList.add("sel");
  return g;
}

// ---------------------------------------------------------------- 道具の欄

const toolButtons = new Map();
for (const t of TOOLS) {
  const b = Object.assign(document.createElement("button"), { className: "tool", title: `${t.label}（${t.key.toUpperCase()}）` });
  b.append(t.label, Object.assign(document.createElement("span"), { className: "k", textContent: t.key.toUpperCase() }));
  b.onclick = () => setTool(t.id);
  toolButtons.set(t.id, b);
  $bar.appendChild(b);
}
$bar.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
const swatches = new Map();
for (const c of COLORS) {
  const b = Object.assign(document.createElement("button"), { className: "swatch", title: c === "fg" ? "文字の色" : c });
  b.style.setProperty("--c", colorValue(c));
  b.onclick = () => setColor(c);
  swatches.set(c, b);
  $bar.appendChild(b);
}
$bar.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
const zoomOut = Object.assign(document.createElement("button"), { className: "tool", textContent: "−", title: "縮小（Ctrl+ホイール・Ctrl+−）" });
const $zoomLabel = Object.assign(document.createElement("button"), { className: "tool zoom-label", title: "100% に戻す（Ctrl+0）" });
const zoomIn = Object.assign(document.createElement("button"), { className: "tool", textContent: "＋", title: "拡大（Ctrl+ホイール・Ctrl+＋）" });
const fitBtn = Object.assign(document.createElement("button"), { className: "tool", textContent: "全体", title: "全体が見えるようにする" });
zoomOut.onclick = () => zoomCenter(1 / 1.2);
zoomIn.onclick = () => zoomCenter(1.2);
$zoomLabel.onclick = () => {
  const r = $stage.getBoundingClientRect();
  zoomAt(1, r.width / 2, r.height / 2);
};
fitBtn.onclick = () => {
  cam = fitCam();
  applyCam();
  changed();
};
$bar.append(zoomOut, $zoomLabel, zoomIn, fitBtn);

function setTool(id) {
  tool = id;
  for (const [k, b] of toolButtons) b.classList.toggle("on", k === id);
  $stage.classList.toggle("drawing", id !== "select");
  if (id !== "select") stopEditing();
}

function setColor(c) {
  color = c;
  for (const [k, b] of swatches) b.classList.toggle("on", k === c);
  // 選んでいる形・付箋の色も変える
  const targets = [...selected].map((id) => shapeOf(id) || cardOf(id)).filter((x) => x && !isEntry(x));
  if (targets.length) {
    remember();
    for (const t of targets) t.color = c;
    renderAll();
    changed();
  }
}

// ---------------------------------------------------------------- 付箋を書く

function startEditing(id, clientX, clientY) {
  if (editing?.id === id) return;
  stopEditing();
  const editor = editors.get(id);
  const el = $world.querySelector(`.card[data-id="${id}"]`);
  if (!editor || !el) return;
  el.classList.add("editing");
  editing = { id, editor, before: JSON.stringify(doc) };
  editor.edit(clientX === undefined);
  if (clientX !== undefined) {
    const pos = editor.view.posAtCoords({ x: clientX, y: clientY });
    if (pos !== null) editor.view.dispatch({ selection: { anchor: pos } });
  }
}

function stopEditing() {
  if (!editing) return;
  const { id, editor, before } = editing;
  editing = null;
  editor.stop();
  $world.querySelector(`.card[data-id="${id}"]`)?.classList.remove("editing");
  const c = cardOf(id);
  // 書き始める前を、やり直しの1歩として覚える
  if (c && JSON.stringify(doc) !== before) {
    undoStack.push(before);
    redoStack = [];
  }
  // 何も書かなかった付箋は消す
  if (c && !(c.text || "").trim()) {
    doc.cards = doc.cards.filter((x) => x !== c);
    renderAll();
    changed();
  }
  $stage.focus();
}

function addTextCard(p) {
  remember();
  const c = { id: uid(), kind: "text", x: Math.round(p.x), y: Math.round(p.y), w: 260, h: 160, text: "", color: color === "fg" ? undefined : color };
  doc.cards.push(c);
  selected.clear();
  selected.add(c.id);
  renderAll();
  changed();
  startEditing(c.id);
}

// ---------------------------------------------------------------- フォルダのカード

function enterFolder(c) {
  stopEditing();
  void save();
  void animate(cam, focusCam(c), 1, 0, 280).then(() => ep.navigate(c.path).catch((err) => {
    $world.style.opacity = "1";
    applyCam();
    say(`開けませんでした：${err.message}`, true);
  }));
}

function renameFolderCard(c) {
  const el = $world.querySelector(`.card[data-id="${c.id}"]`);
  const name = el?.querySelector(".name");
  if (!el || !name) return;
  const input = Object.assign(document.createElement("input"), { value: c.name });
  name.replaceWith(input);
  input.focus();
  // ファイルは、拡張子の前までを選ぶ
  const dot = c.kind === "file" ? c.name.lastIndexOf(".") : -1;
  if (dot > 0) input.setSelectionRange(0, dot);
  else input.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return;
    done = true;
    input.replaceWith(name);
    const next = input.value.trim();
    if (!ok || !next || next === c.name) return;
    try {
      await ep.rename({ id: c.fid, path: c.path }, next);
    } catch (err) {
      say(err.code === "exists" ? "同じ名前があります" : err.code === "invalid" ? "その名前は使えません" : `名前を変えられませんでした：${err.message}`, true);
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") void finish(true);
    if (e.key === "Escape") void finish(false);
  });
  input.addEventListener("blur", () => void finish(true));
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** フォルダの中身から、子フォルダ・ファイルのカードを合わせる（増えたら空いている所に置き、消えたらカードも消す） */
function syncFolderCards() {
  const keep = new Set();
  let added = false;
  let boxes = null;
  let files = 0;
  // フォルダを先に置く（空いている所は、置いた順に埋まる）
  const entries = [...folder.entries.filter((e) => e.kind === "folder"), ...folder.entries.filter((e) => e.kind === "file")];
  for (const e of entries) {
    const same = entries.filter((x) => x.kind === e.kind);
    // ファイルID で探し、無ければ名前で探す（別の PC ではファイルID が違うので、同期したノートは名前で合わせる）
    let c =
      doc.cards.find((x) => x.kind === e.kind && !keep.has(x.id) && e.id && x.fid === e.id) ||
      doc.cards.find((x) => x.kind === e.kind && !keep.has(x.id) && x.name === e.name && !same.some((d) => d.id && d.id === x.fid));
    if (!c) {
      if (e.kind === "file" && files >= FILES_MAX) continue;
      boxes ??= doc.cards.map(cardRect);
      const p = pendingPlace && pendingPlace.id === e.id ? pendingPlace : freeSlot(boxes);
      if (pendingPlace && pendingPlace.id === e.id) pendingPlace = null;
      c = { id: uid(), kind: e.kind, fid: e.id, path: e.path, name: e.name, x: Math.round(p.x), y: Math.round(p.y) };
      doc.cards.push(c);
      added = true;
    }
    if (e.kind === "file") files++;
    c.fid = e.id;
    c.path = e.path;
    c.name = e.name;
    keep.add(c.id);
  }
  const gone = doc.cards.filter((c) => isEntry(c) && !keep.has(c.id));
  if (gone.length) {
    // 消えたフォルダにつながっていた線は、その場所に端を残す
    for (const g of gone) {
      const b = cardRect(g);
      for (const s of doc.shapes) for (const end of [s.a, s.b]) if (end && end.card === g.id) Object.assign(end, { card: undefined, x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
    doc.cards = doc.cards.filter((c) => !gone.includes(c));
  }
  return added || gone.length > 0;
}

// ---------------------------------------------------------------- マウス

/** その点にあるカード（ドラッグ中の自分は除く） */
function cardAt(clientX, clientY, except) {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const card = el.closest?.(".card");
    if (card && card.dataset.id !== except) return cardOf(card.dataset.id);
  }
  return null;
}

let gesture = null;

$stage.addEventListener("pointerdown", (e) => {
  if (animFrame) return;
  const target = e.target;
  // 書いている付箋の中は、エディタに任せる
  if (editing && target.closest(`.card[data-id="${editing.id}"]`) && !target.closest(".grip")) return;
  if (e.button === 1 || (e.button === 0 && tool === "select" && !target.closest(".card") && !target.closest(".hit"))) {
    // 真ん中のボタン、または空いている所を左でつかむと、平面を動かす
    if (e.button === 0 && !e.shiftKey) {
      selected.clear();
      renderAll();
    }
    stopEditing();
    gesture = { type: "pan", sx: e.clientX, sy: e.clientY, cam: { ...cam } };
    $stage.classList.add("panning");
  } else if (e.button === 0 && tool === "select") {
    const cardEl = target.closest(".card");
    const id = cardEl ? cardEl.dataset.id : target.closest("g")?.dataset.id;
    if (!id) return;
    if (editing && editing.id !== id) stopEditing();
    if (target.closest(".grip")) {
      const c = cardOf(id);
      gesture = { type: "resize", id, sx: e.clientX, sy: e.clientY, w: c.w, h: c.h, moved: false };
    } else {
      if (!selected.has(id)) {
        if (!e.shiftKey) selected.clear();
        selected.add(id);
        renderAll();
      } else if (e.shiftKey) {
        selected.delete(id);
        renderAll();
        return;
      }
      const start = toWorld(e.clientX, e.clientY);
      const items = [...selected].map((sid) => cardOf(sid) || shapeOf(sid)).filter(Boolean);
      gesture = { type: "move", start, orig: JSON.parse(JSON.stringify(items.map((it) => ({ id: it.id, it })))), moved: false };
    }
  } else if (e.button === 0 && tool === "text") {
    addTextCard(toWorld(e.clientX, e.clientY));
    setTool("select");
    return;
  } else if (e.button === 0) {
    // 描く
    stopEditing();
    const p = toWorld(e.clientX, e.clientY);
    const s = { id: uid(), kind: tool, color, width: 2 };
    if (tool === "arrow" || tool === "line") {
      const c = cardAt(e.clientX, e.clientY);
      s.a = c ? { card: c.id } : { x: p.x, y: p.y };
      s.b = { x: p.x, y: p.y };
    } else if (tool === "pen") s.points = [[Math.round(p.x), Math.round(p.y)]];
    else Object.assign(s, { x: p.x, y: p.y, w: 0, h: 0 });
    gesture = { type: "draw", shape: s, start: p };
  } else return;
  $stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

// ---------------------------------------------------------------- ドラッグ＆ドロップ（ファイル・フォルダ）
// フォルダ・ファイルのカードをつかんで動かすと、ふだんは平面の上で位置を動かす。次のときは、本体のドラッグ＆ドロップに切り替わる
// （そこから先は Win11 風ビューなどと同じ：エクスプローラ・Chrome・左の欄・タブ・フォルダのカードへ落とせる。Ctrl でコピー）：
// - 平面の外へ出したとき
// - ほかのフォルダのカードの上で、少し止めたとき（そのフォルダへ移す）
const HOVER_MS = 450;

/** その点にある、つかんでいない（選んでいない）カード */
function cardBelow(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    const card = el.closest?.(".card");
    if (card && !selected.has(card.dataset.id)) return cardOf(card.dataset.id);
  }
  return null;
}

function setHover(g, c) {
  if (g.hover?.id === (c?.id ?? null)) return;
  if (g.hover) {
    clearTimeout(g.hover.timer);
    $world.querySelector(`.card[data-id="${g.hover.id}"]`)?.classList.remove("drop-hover");
  }
  g.hover = null;
  if (!c) return;
  $world.querySelector(`.card[data-id="${c.id}"]`)?.classList.add("drop-hover");
  g.hover = { id: c.id, timer: setTimeout(() => gesture === g && handOver(g), HOVER_MS) };
}

function watchTransfer(g, e) {
  if (!g.orig.some((o) => cardOf(o.id) && isEntry(cardOf(o.id)))) return;
  g.at = { x: e.clientX, y: e.clientY };
  if (!g.told) {
    g.told = true;
    say("外へドラッグするとほかのアプリへ渡せます。フォルダの上で止めると、そのフォルダへ移します（Ctrl でコピー）");
  }
  const r = $stage.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return handOver(g);
  const under = cardBelow(e.clientX, e.clientY);
  setHover(g, under && under.kind === "folder" ? under : null);
}

/** このビューの中の、落とせるフォルダのカード（つかんでいるものは除く）。位置は iframe の中の座標 */
function dropTargets() {
  const out = [];
  for (const el of $world.querySelectorAll(".card.folder")) {
    const c = cardOf(el.dataset.id);
    if (!c || selected.has(c.id)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    out.push({ entry: { id: c.fid, path: c.path }, rect: r });
    if (out.length >= 500) break;
  }
  return out;
}

/** 位置を動かすのをやめて（元に戻して）、本体のドラッグ＆ドロップに任せる */
function handOver(g) {
  if (gesture !== g) return;
  gesture = null;
  setHover(g, null);
  const items = g.orig.map((o) => cardOf(o.id)).filter((c) => c && isEntry(c)).map((c) => ({ id: c.fid, path: c.path }));
  // 位置を、つかむ前に戻す
  const back = new Map(g.orig.map((o) => [o.id, o.it]));
  doc.cards = doc.cards.map((c) => (back.has(c.id) ? back.get(c.id) : c));
  doc.shapes = doc.shapes.map((s) => (back.has(s.id) ? back.get(s.id) : s));
  if (g.moved) undoStack.pop();
  renderAll();
  say("");
  $stage.classList.remove("panning");
  const at = g.at || { x: 0, y: 0 };
  if (items.length) ep.drag.start({ items, x: at.x, y: at.y, targets: dropTargets() }).catch((err) => say(`ドラッグできませんでした：${err.message}`, true));
}

// ほかのビューや外のウィンドウからのドラッグ中に、このタブに切り替わったら、落とせるフォルダのカードを知らせる
ep.onDragTargets(() => ep.drag.targets(dropTargets()).catch(() => {}));

let snapEl = null;
function showSnap(c) {
  const el = c ? $world.querySelector(`.card[data-id="${c.id}"]`) : null;
  if (snapEl === el) return;
  snapEl?.classList.remove("snap");
  snapEl = el;
  snapEl?.classList.add("snap");
}

$stage.addEventListener("pointermove", (e) => {
  if (!gesture) {
    if (tool === "arrow" || tool === "line") showSnap(cardAt(e.clientX, e.clientY));
    return;
  }
  const g = gesture;
  if (g.type === "pan") {
    cam = { ...g.cam, x: g.cam.x + e.clientX - g.sx, y: g.cam.y + e.clientY - g.sy };
    applyCam();
  } else if (g.type === "resize") {
    const c = cardOf(g.id);
    if (!g.moved) {
      remember();
      g.moved = true;
    }
    c.w = Math.max(120, Math.round(g.w + (e.clientX - g.sx) / cam.z));
    c.h = Math.max(60, Math.round(g.h + (e.clientY - g.sy) / cam.z));
    renderCard(c);
    renderShapes();
  } else if (g.type === "move") {
    const p = toWorld(e.clientX, e.clientY);
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx * cam.z, dy * cam.z) < 4) return;
    if (!g.moved) {
      remember();
      g.moved = true;
    }
    for (const { id, it: o } of g.orig) {
      const cur = cardOf(id) || shapeOf(id);
      if (!cur) continue;
      if (cur.kind === "pen") cur.points = o.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
      else if (cur.kind === "arrow" || cur.kind === "line") {
        // つながっていない端だけ動かす
        if (!cur.a.card) Object.assign(cur.a, { x: o.a.x + dx, y: o.a.y + dy });
        if (!cur.b.card) Object.assign(cur.b, { x: o.b.x + dx, y: o.b.y + dy });
      } else {
        cur.x = Math.round(o.x + dx);
        cur.y = Math.round(o.y + dy);
      }
    }
    for (const { id } of g.orig) if (cardOf(id)) renderCard(cardOf(id));
    renderShapes();
    watchTransfer(g, e);
  } else if (g.type === "draw") {
    const p = toWorld(e.clientX, e.clientY);
    const s = g.shape;
    if (s.kind === "arrow" || s.kind === "line") {
      const c = cardAt(e.clientX, e.clientY);
      showSnap(c && c.id !== s.a.card ? c : null);
      s.b = c && c.id !== s.a.card ? { card: c.id } : { x: p.x, y: p.y };
    } else if (s.kind === "pen") {
      const last = s.points[s.points.length - 1];
      // 近すぎる点は捨てて、保存の大きさを抑える
      if (Math.hypot(p.x - last[0], p.y - last[1]) * cam.z >= 3) s.points.push([Math.round(p.x), Math.round(p.y)]);
    } else {
      let x = Math.min(g.start.x, p.x);
      let y = Math.min(g.start.y, p.y);
      let w = Math.abs(p.x - g.start.x);
      let h = Math.abs(p.y - g.start.y);
      // Shift を押していれば、正方形・正円
      if (e.shiftKey) {
        const m = Math.max(w, h);
        if (p.x < g.start.x) x = g.start.x - m;
        if (p.y < g.start.y) y = g.start.y - m;
        w = h = m;
      }
      Object.assign(s, { x, y, w, h });
    }
    renderShapes();
    $shapes.appendChild(shapeElement(s, true));
  }
});

function endGesture(e) {
  const g = gesture;
  gesture = null;
  if (g?.hover) setHover(g, null);
  if (g?.told) say("");
  $stage.classList.remove("panning");
  showSnap(null);
  if (!g) return;
  if (g.type === "pan") changed();
  else if ((g.type === "move" || g.type === "resize") && g.moved) changed();
  else if (g.type === "draw" && e.type === "pointerup") {
    const s = g.shape;
    const box = shapeBox(s);
    const big = box && Math.max(box.w, box.h) * cam.z >= 6;
    if (big && !(s.kind !== "pen" && s.a && s.b && s.a.card && s.a.card === s.b.card)) {
      if (s.kind === "rect" || s.kind === "ellipse") Object.assign(s, { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) });
      remember();
      doc.shapes.push(s);
      selected.clear();
      changed();
      // ペンは続けて描けるように、ほかは描き終わったら「選ぶ」に戻す
      if (tool !== "pen") setTool("select");
    }
    renderAll();
  }
}
$stage.addEventListener("pointerup", endGesture);
$stage.addEventListener("pointercancel", endGesture);

$stage.addEventListener("dblclick", (e) => {
  if (tool !== "select") return;
  // 押したときに平面がポインタを捕まえているので、ダブルクリックの相手は位置から探し直す
  const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  const cardEl = under.closest(".card");
  if (!cardEl) {
    if (!under.closest(".hit")) addTextCard(toWorld(e.clientX, e.clientY));
    return;
  }
  const c = cardOf(cardEl.dataset.id);
  if (!c) return;
  if (c.kind === "folder") enterFolder(c);
  else if (c.kind === "file") void ep.open({ id: c.fid, path: c.path }).catch((err) => say(`開けませんでした：${err.message}`, true));
  else startEditing(c.id, e.clientX, e.clientY);
});

$stage.addEventListener(
  "wheel",
  (e) => {
    const r = $stage.getBoundingClientRect();
    if (e.ctrlKey) {
      e.preventDefault();
      zoomAt(cam.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    // 書いている付箋の中は、付箋の中身を動かす
    if (editing && e.target.closest(`.card[data-id="${editing.id}"]`)) return;
    e.preventDefault();
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    cam = { ...cam, x: cam.x - dx, y: cam.y - dy };
    applyCam();
    changed();
  },
  { passive: false },
);

$stage.addEventListener("contextmenu", async (e) => {
  e.preventDefault();
  const cardEl = e.target.closest(".card");
  const id = cardEl ? cardEl.dataset.id : e.target.closest("g")?.dataset.id;
  const c = id ? cardOf(id) : null;
  if (c && isEntry(c)) {
    // フォルダ・ファイルは、本体のいつものメニュー（開く・名前の変更・タグなど）
    const { chosen } = await ep.showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ id: c.fid, path: c.path }],
      extra: c.kind === "folder" ? [{ id: "enter", label: "このフォルダのノートへ" }] : [],
    });
    if (chosen === "enter") enterFolder(c);
    return;
  }
  if (id) {
    if (!selected.has(id)) {
      selected.clear();
      selected.add(id);
      renderAll();
    }
    const { chosen } = await ep.showMenu({ x: e.clientX, y: e.clientY, items: [], extra: [{ id: "delete", label: "消す" }] });
    if (chosen === "delete") deleteSelected();
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  const { chosen } = await ep.showMenu({
    x: e.clientX,
    y: e.clientY,
    items: [],
    extra: [
      { id: "text", label: "ここに付箋を置く" },
      { id: "folder", label: "ここに新しいフォルダーを作る" },
      { id: "fit", label: "全体を表示" },
    ],
  });
  if (chosen === "text") addTextCard(p);
  else if (chosen === "fit") fitBtn.onclick();
  else if (chosen === "folder") {
    try {
      const entry = await ep.createFolder();
      pendingPlace = { id: entry.id, x: p.x, y: p.y };
    } catch (err) {
      say(`フォルダを作れませんでした：${err.message}`, true);
    }
  }
});

// 新しいフォルダーを作ったあと、本体から「名前を変えて」と頼まれる
ep.onAction((a) => {
  if (a.action !== "rename") return;
  const tryRename = (n) => {
    const c = doc.cards.find((x) => x.kind === "folder" && (a.entry.id ? x.fid === a.entry.id : x.path === a.entry.path));
    if (!c) {
      const f = doc.cards.find((x) => x.kind === "file" && (a.entry.id ? x.fid === a.entry.id : x.path === a.entry.path));
      if (f) return renameFolderCard(f);
    }
    if (c) renameFolderCard(c);
    else if (n > 0) setTimeout(() => tryRename(n - 1), 100);
  };
  tryRename(10);
});

function deleteSelected() {
  // フォルダのカードは、実際のフォルダを映したものなので、ここでは消さない
  const ids = [...selected].filter((id) => shapeOf(id) || cardOf(id)?.kind === "text");
  if (!ids.length) return;
  remember();
  doc.cards = doc.cards.filter((c) => !ids.includes(c.id));
  doc.shapes = doc.shapes.filter((s) => !ids.includes(s.id));
  // 消した付箋につながっていた線は、その場所に端を残す
  selected.clear();
  renderAll();
  changed();
}

// ---------------------------------------------------------------- キー

document.addEventListener("keydown", (e) => {
  if (editing) {
    if (e.key === "Escape") {
      e.preventDefault();
      stopEditing();
    }
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.altKey) {
    if (k === "z" && !e.shiftKey) undo(false);
    else if (k === "y" || (k === "z" && e.shiftKey)) undo(true);
    else if (k === "a") {
      for (const c of doc.cards) selected.add(c.id);
      for (const s of doc.shapes) selected.add(s.id);
      renderAll();
    } else if (k === "0") $zoomLabel.onclick();
    else if (k === "=" || k === "+" || k === ";") zoomCenter(1.2);
    else if (k === "-") zoomCenter(1 / 1.2);
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (k === "delete" || k === "backspace") deleteSelected();
  else if (k === "escape") {
    selected.clear();
    setTool("select");
    renderAll();
  } else if (k === "enter" && selected.size === 1) {
    const c = cardOf([...selected][0]);
    if (c?.kind === "folder") enterFolder(c);
    else if (c?.kind === "file") void ep.open({ id: c.fid, path: c.path }).catch((err) => say(`開けませんでした：${err.message}`, true));
    else if (c?.kind === "text") startEditing(c.id);
  } else if (k === "f2" && selected.size === 1) {
    const c = cardOf([...selected][0]);
    if (c && isEntry(c)) renameFolderCard(c);
  } else {
    const t = TOOLS.find((x) => x.key === k);
    if (!t) return;
    setTool(t.id);
  }
  e.preventDefault();
});

// 付箋の外をクリックしたら、書き終わり
document.addEventListener("pointerdown", (e) => {
  if (editing && !e.target.closest(`.card[data-id="${editing.id}"]`)) stopEditing();
}, true);

// ---------------------------------------------------------------- フォルダが変わったとき

/** 前に見ていたフォルダ（入る・出るのアニメーションを決めるため） */
let prev = null;

async function load(f) {
  const saved = await ep.folderData.get(f).catch(() => undefined);
  if (saved && Array.isArray(saved.cards)) return { doc: { cards: saved.cards, shapes: saved.shapes || [] }, cam: saved.cam || null };
  // 以前はこのビューの保存場所に置いていた。あれば、フォルダの中へ移す
  const local = await ep.storage.get(keyOf(f)).catch(() => undefined);
  if (local && Array.isArray(local.cards)) return { doc: { cards: local.cards, shapes: local.shapes || [] }, cam: local.cam || null, migrated: keyOf(f) };
  // 以前の形（1ページの文章）のノートがあれば、付箋1枚にして引き継ぐ
  const old = await ep.storage.get(oldKeyOf(f)).catch(() => undefined);
  if (old && typeof old.text === "string" && old.text.trim()) {
    return { doc: { cards: [{ id: uid(), kind: "text", x: 0, y: -260, w: 420, h: 220, text: old.text }], shapes: [] }, cam: null, migrated: oldKeyOf(f) };
  }
  return { doc: { cards: [], shapes: [] }, cam: null };
}

ep.onFolder(async (f) => {
  const next = keyOf(f);
  if (next === key) {
    // 同じフォルダの読み直し（子フォルダが増えた、など）
    folder = f;
    if (syncFolderCards()) changed();
    renderAll();
    return;
  }
  await save();
  stopEditing();
  const from = prev;
  folder = f;
  key = next;
  $title.textContent = `ノート — ${f.name}`;
  const loaded = await load(f);
  if (key !== next) return; // 読み込み中に別のフォルダへ移った
  doc = loaded.doc;
  undoStack = [];
  redoStack = [];
  selected.clear();
  for (const el of [...$world.querySelectorAll(".card")]) el.remove();
  for (const ed of editors.values()) ed.destroy();
  editors.clear();
  const changedCards = syncFolderCards();
  renderAll();
  cam = loaded.cam || fitCam();
  if (changedCards || loaded.migrated) {
    dirty = true;
    await save();
    // 移し終えたら、古い場所のものは消す（保存できなかったら残す）
    if (loaded.migrated && !dirty) await ep.storage.delete(loaded.migrated).catch(() => {});
  }
  // 入る・出るのアニメーション
  const goingIn = from && f.parentPath && f.parentPath.toLowerCase() === from.path.toLowerCase();
  const goingOut = from && from.parentPath && from.parentPath.toLowerCase() === f.path.toLowerCase();
  if (goingIn) {
    const r = $stage.getBoundingClientRect();
    const small = { x: r.width / 2 - (r.width / 2 - cam.x) * 0.4, y: r.height / 2 - (r.height / 2 - cam.y) * 0.4, z: cam.z * 0.4 };
    await animate(small, cam, 0, 1, 300);
  } else if (goingOut) {
    const child = doc.cards.find((c) => c.kind === "folder" && (from.id ? c.fid === from.id : c.path.toLowerCase() === from.path.toLowerCase()));
    if (child) await animate(focusCam(child), cam, 0, 1, 340);
  }
  $world.style.opacity = "1";
  applyCam();
  prev = { id: f.id, path: f.path, parentPath: f.parentPath };
  say("");
});

// 設定「ファイルを表示する」：オフでも、ファイルのカードの位置は覚えておく（隠すだけ）
const applyShowFiles = (s) => $world.classList.toggle("hide-files", s.showFiles === false);
void ep.settings.get().then(applyShowFiles);
ep.onSettings(applyShowFiles);

ep.onTheme(() => renderAll());
window.addEventListener("blur", () => void save());
setTool("select");
setColor("fg");
applyCam();
$stage.focus();
