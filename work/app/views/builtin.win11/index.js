// 標準のビュー「Win11 風」。Windows 11 のエクスプローラの「詳細」表示と同じ形の一覧。
// MOD の手本も兼ねる：window.explorerPlus から今のフォルダを受け取り、好きなように描き、操作を本体に頼む。
const ep = window.explorerPlus;

// MOD のフォルダのファイルは、相対パスで読み込める
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./style.css", import.meta.url).href;
document.head.appendChild(css);

const list = document.createElement("div");
list.className = "list";
list.tabIndex = 0;
document.body.appendChild(list);

let folder = null; // 今のフォルダ（FolderSnapshot）
let rows = []; // 表示している順の Entry
let selected = new Set(); // 選んでいる Entry の path
let anchor = null; // Shift で範囲を選ぶときの起点（行の番号）
let cursor = null; // キーボードで動かす今の行（行の番号）
let sort = { key: "name", dir: 1 }; // 列の見出しで並べ替える。"name" の昇順は本体の並び順（フォルダが先・自然な順）のまま

const COLUMNS = [
  { key: "name", label: "名前" },
  { key: "modified", label: "更新日時" },
  { key: "type", label: "種類" },
  { key: "size", label: "サイズ" },
];

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

function sortedRows() {
  // 隠しファイルは、Windows の既定と同じく表示しない
  const visible = folder.entries.filter((e) => !e.hidden);
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

function render() {
  rows = sortedRows();
  list.textContent = "";
  if (rows.length === 0) {
    list.appendChild(Object.assign(document.createElement("div"), { className: "empty", textContent: "このフォルダーは空です。" }));
    return;
  }
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const c of COLUMNS) {
    const th = document.createElement("th");
    th.className = c.key;
    th.textContent = c.label;
    if (sort.key === c.key) th.append(Object.assign(document.createElement("span"), { className: "arrow", textContent: sort.dir === 1 ? "▲" : "▼" }));
    th.onclick = () => {
      sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 };
      render();
    };
    head.appendChild(th);
  }
  const body = table.createTBody();
  rows.forEach((e, i) => {
    const tr = body.insertRow();
    tr.dataset.index = String(i);
    if (selected.has(e.path)) tr.classList.add("selected");
    const name = tr.insertCell();
    name.className = "name";
    const cell = document.createElement("div");
    cell.className = "name-cell";
    if (e.iconUrl) cell.appendChild(Object.assign(document.createElement("img"), { src: e.iconUrl, alt: "", loading: "lazy" }));
    cell.appendChild(Object.assign(document.createElement("span"), { textContent: e.name }));
    name.appendChild(cell);
    Object.assign(tr.insertCell(), { className: "modified", textContent: formatDate(e.modified) });
    Object.assign(tr.insertCell(), { className: "type", textContent: typeLabel(e) });
    Object.assign(tr.insertCell(), { className: "size", textContent: e.kind === "file" ? formatSize(e.size) : "" });
  });
  list.appendChild(table);
}

function rowElement(i) {
  return list.querySelector(`tr[data-index="${i}"]`);
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
  for (const tr of list.querySelectorAll("tbody tr")) tr.classList.toggle("selected", selected.has(rows[Number(tr.dataset.index)].path));
  rowElement(i)?.scrollIntoView({ block: "nearest" });
}

const selectedEntries = () => rows.filter((e) => selected.has(e.path));
const rectOf = (i) => rowElement(i)?.querySelector(".name-cell")?.getBoundingClientRect();

function report(err) {
  // ごみ箱の確認で「やめる」を選んだ（denied）ときは、何もしない
  if (err && err.code !== "denied") console.warn(err);
}

function openAt(i) {
  ep.open(rows[i], { from: rectOf(i) }).catch(report);
}

list.addEventListener("mousedown", (ev) => {
  const tr = ev.target.closest("tbody tr");
  if (!tr) {
    if (!ev.target.closest("thead")) {
      selected.clear();
      render();
    }
    return;
  }
  select(Number(tr.dataset.index), { ctrl: ev.ctrlKey, shift: ev.shiftKey });
});

list.addEventListener("dblclick", (ev) => {
  const tr = ev.target.closest("tbody tr");
  if (tr) openAt(Number(tr.dataset.index));
});

list.addEventListener("keydown", (ev) => {
  if (rows.length === 0) return;
  const current = cursor ?? -1;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, current + (ev.key === "ArrowDown" ? 1 : -1)));
    select(next, { shift: ev.shiftKey });
  } else if (ev.key === "Home" || ev.key === "End") {
    ev.preventDefault();
    select(ev.key === "Home" ? 0 : rows.length - 1, { shift: ev.shiftKey });
  } else if (ev.key === "Enter" && current >= 0) {
    ev.preventDefault();
    openAt(current);
  } else if (ev.key === "Delete") {
    const items = selectedEntries();
    if (items.length > 0) ep.trash(items, { from: rectOf(current) }).catch(report);
  } else if (ev.key === "Backspace") {
    ep.navigateUp().catch(report);
  } else if (ev.key === "a" && ev.ctrlKey) {
    ev.preventDefault();
    selected = new Set(rows.map((e) => e.path));
    render();
  }
});

ep.onFolder((f) => {
  // 別のフォルダに移ったら、選択と並べ替えを元に戻す。同じフォルダの更新（大きさが届いた、など）なら保つ
  const moved = !folder || folder.path !== f.path;
  folder = f;
  if (moved) {
    selected.clear();
    anchor = null;
    cursor = null;
    list.scrollTop = 0;
  } else {
    const paths = new Set(f.entries.map((e) => e.path));
    selected = new Set([...selected].filter((p) => paths.has(p)));
  }
  render();
  list.focus();
});
