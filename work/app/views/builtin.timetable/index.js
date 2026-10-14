// 標準のビュー「時間割」（ADR 0010・0012・0013）。学校のフォルダ（例：学業\A校）ごとの時間割。
// 曜日×時限の表と、その下のオンデマンドの授業。コマにフォルダを結びつけ、今の授業を光らせる。
// 操作はマウスが主：クリックで選ぶ、ダブルクリックで開く、右クリックでメニュー。キーボードでも使える。
import { ask, button, confirm, pick } from "/__runtime/tui.js";

const ep = window.explorerPlus;

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_SETS = [
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5, 6],
  [0, 1, 2, 3, 4, 5, 6],
];
// 「例を入れる」で入れる時限（90分授業の例。あとで自由に変えられる）
const EXAMPLE_PERIODS = [
  ["1限", "09:00", "10:30"],
  ["2限", "10:40", "12:10"],
  ["3限", "13:00", "14:30"],
  ["4限", "14:40", "16:10"],
  ["5限", "16:20", "17:50"],
];

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.head.appendChild(
  Object.assign(document.createElement("style"), {
    textContent: `
      .wrap { flex: 1; min-height: 0; overflow: auto; padding: 14px 10px 4px; display: flex; flex-direction: column; gap: 16px; }
      .wrap > .tui-box { flex: none; }
      .tui-grid td { cursor: default; height: 3.4em; }
      .tui-grid td:hover { background: color-mix(in srgb, var(--tui-fg) 7%, transparent); }
      .tui-grid th.period { cursor: context-menu; }
      .empty-state { padding: 24px 2ch; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
      .ondemand-add { padding: 4px 1ch 2px; }
    `,
  }),
);

document.body.className = "tui";
document.body.innerHTML = `
  <div class="tui-toolbar" id="toolbar"></div>
  <div class="wrap" id="wrap"></div>
  <div class="tui-message" id="message"></div>`;

const $toolbar = document.getElementById("toolbar");
const $wrap = document.getElementById("wrap");
const $message = document.getElementById("message");

let folder = null; // 今のフォルダ（学校のフォルダ）
let tt = null; // このフォルダの時間割（無ければ null）
let now = null; // { slot, period } | null
let sel = { r: 0, c: 0 }; // 選んでいるコマ（時限の番号・曜日の番号）

function say(text, isError = false) {
  $message.textContent = text;
  $message.classList.toggle("is-error", isError);
}

const report = (err) => say(`できませんでした：${(err && err.message ? err.message : String(err)).split("\n")[0]}`, true);

const slotAt = (r, c) => {
  const p = tt?.periods[r];
  const d = tt?.days[c];
  return p && d !== undefined ? tt.slots.find((s) => s.day === d && s.periodId === p.id) || null : null;
};

/** ビュー独自の項目だけの右クリックのメニュー（本体が描く。ADR 0013 判断2） */
async function menu(e, entries) {
  e.preventDefault();
  const list = entries.filter(Boolean);
  const { chosen } = await ep.showMenu({ x: e.clientX, y: e.clientY, items: [], extra: list.map(({ id, label }) => ({ id, label })) });
  list.find((m) => m.id === chosen)?.run();
}

// ---- 保存（本体が検査する。誤りは下の行に出す） ----

async function save(next, done) {
  try {
    tt = await ep.timetable.set(next);
    now = await ep.timetable.current().catch(() => null);
    if (done) say(done);
  } catch (err) {
    report(err);
  }
  render();
}

function withSlot(r, c, change) {
  const p = tt.periods[r];
  const d = tt.days[c];
  const old = slotAt(r, c);
  const slot = change(old ? { ...old } : { day: d, periodId: p.id, title: "", folders: [] });
  const slots = tt.slots.filter((s) => s !== old);
  if (slot) slots.push(slot);
  return { ...tt, slots };
}

function withOndemand(item, change) {
  const list = tt.ondemand || [];
  const next = change(item ? { ...item } : null);
  return { ...tt, ondemand: item ? list.flatMap((x) => (x === item ? (next ? [next] : []) : [x])) : [...list, next] };
}

// ---- 授業のフォルダ（結びつける・作る・開く） ----

const subfolders = () => (folder?.entries || []).filter((e) => e.kind === "folder" && !e.hidden);

/** このフォルダ（学校）の中のフォルダから選ぶ */
async function chooseSubfolder(title) {
  const items = subfolders().map((e) => ({ label: e.name, value: { id: e.id, path: e.path } }));
  return pick({ title: `「${title || "このコマ"}」に結びつけるフォルダ`, items, empty: "このフォルダの中にフォルダがありません（「授業のフォルダを作る」で作れます）" });
}

/** 授業名でフォルダを作って結びつける（学校のフォルダの下にできる。ADR 0012 判断1） */
async function createClassFolder(title) {
  const name = await ask({ label: "作るフォルダの名前:", value: title, okLabel: "作る" });
  if (!name) return null;
  const e = await ep.createFolder(name);
  return { id: e.id, path: e.path };
}

function openFolder(ref) {
  ep.open(ref, { newTab: true }).catch(() => say(`フォルダが見つかりません：${ref.path}`, true));
}

function classMenu(item, setFolders, setTitle, remove) {
  const linked = item?.folders[0];
  return [
    linked && { id: "open", label: "フォルダを開く", run: () => openFolder(linked) },
    { id: "title", label: item?.title ? "授業名を変える…" : "授業名を入れる…", run: setTitle },
    { id: "create", label: "授業のフォルダを作って結びつける…", run: async () => {
      const ref = await createClassFolder(item?.title || "").catch(report);
      if (ref) setFolders([ref]);
    } },
    { id: "choose", label: "このフォルダの中から結びつける…", run: async () => {
      const ref = await chooseSubfolder(item?.title);
      if (ref) setFolders([ref]);
    } },
    linked && { id: "unlink", label: "フォルダの結びつけを外す", run: () => setFolders([]) },
    item && { id: "remove", label: "消す", run: remove },
  ];
}

// ---- コマ・時限・オンデマンドの操作 ----

const cellActions = (r, c) => {
  const s = slotAt(r, c);
  const setTitle = async () => {
    const title = await ask({ label: "授業名:", value: s?.title || "", okLabel: "決める" });
    if (title !== null) save(withSlot(r, c, (x) => ({ ...x, title })));
  };
  return {
    slot: s,
    setTitle,
    menu: classMenu(
      s,
      (folders) => save(withSlot(r, c, (x) => ({ ...x, folders }))),
      setTitle,
      () => save(withSlot(r, c, () => null), "コマを消しました"),
    ),
    open: () => (s?.folders[0] ? openFolder(s.folders[0]) : setTitle()),
  };
};

function parsePeriodText(text) {
  const m = /^\s*(\S+)\s+(\d{1,2}:\d{2})\s*[-〜~ ]\s*(\d{1,2}:\d{2})\s*$/.exec(text || "");
  if (!m) return null;
  const pad = (t) => (t.length === 4 ? `0${t}` : t);
  return { label: m[1], start: pad(m[2]), end: pad(m[3]) };
}

function newId(prefix, list) {
  let n = list.length + 1;
  while (list.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

async function addPeriod() {
  const text = await ask({ label: "時限（名前 始まり 終わり）:", placeholder: "例：6限 18:00 19:30", okLabel: "足す" });
  if (text === null) return;
  const p = parsePeriodText(text);
  if (!p) return say("「6限 18:00 19:30」の形で入れてください", true);
  save({ ...tt, periods: [...tt.periods, { id: newId("p", tt.periods), ...p }] });
}

async function editPeriod(p) {
  const text = await ask({ label: "時限（名前 始まり 終わり）:", value: `${p.label} ${p.start} ${p.end}`, okLabel: "変える" });
  if (text === null) return;
  const q = parsePeriodText(text);
  if (!q) return say("「1限 09:00 10:30」の形で入れてください", true);
  save({ ...tt, periods: tt.periods.map((x) => (x === p ? { ...x, ...q } : x)) });
}

async function deletePeriod(p) {
  const n = tt.slots.filter((s) => s.periodId === p.id).length;
  if (await confirm({ message: `時限「${p.label}」を消しますか？${n ? `（この時限のコマ ${n} 個も消えます）` : ""}`, okLabel: "消す" })) {
    save({ ...tt, periods: tt.periods.filter((x) => x !== p), slots: tt.slots.filter((s) => s.periodId !== p.id) });
  }
}

async function addOndemand() {
  const title = await ask({ label: "オンデマンドの授業名:", okLabel: "足す" });
  if (title) save(withOndemand(null, () => ({ id: newId("o", tt.ondemand || []), title, folders: [] })));
}

// ---- 描画 ----

function renderToolbar() {
  $toolbar.textContent = "";
  if (!tt) return;
  if (tt.periods.length === 0) {
    $toolbar.append(button("例（90分×5）を入れる", () => save({ ...tt, periods: EXAMPLE_PERIODS.map(([label, start, end], i) => ({ id: `p${i + 1}`, label, start, end })) }, "例を入れました。時限は右クリックで変えられます"), { accent: true }));
  }
  const i = DAY_SETS.findIndex((set) => set.join() === tt.days.join());
  const daysLabel = i === 0 ? "月〜金" : i === 1 ? "月〜土" : i === 2 ? "日〜土" : "曜日";
  $toolbar.append(
    button("＋ 時限", addPeriod),
    button(`曜日：${daysLabel}`, () => save({ ...tt, days: DAY_SETS[(i + 1) % DAY_SETS.length] }), { title: "押すたびに 月〜金 → 月〜土 → 日〜土 と切り替わる" }),
    button("＋ オンデマンド", addOndemand),
    button("この時間割を消す", async () => {
      if (await confirm({ message: `「${folder.name}」の時間割を消しますか？（フォルダは消えません）`, okLabel: "消す" })) {
        await ep.timetable.delete().catch(report);
      }
    }),
  );
}

function renderEmpty() {
  const box = document.createElement("section");
  box.className = "tui-box";
  box.innerHTML = `<span class="tui-box-title">時間割</span>`;
  const inner = document.createElement("div");
  inner.className = "empty-state";
  inner.append(
    Object.assign(document.createElement("div"), { textContent: `「${folder?.name ?? ""}」には、まだ時間割がありません。` }),
    Object.assign(document.createElement("div"), { className: "tui-dim", textContent: "学校ごとのフォルダ（例：学業\\A校）を開いて作ると、授業のフォルダをその中に作れます。2つの学校に通っていても、学校ごとに時間割を持てます。" }),
    button("このフォルダに時間割を作る", () => save({ days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null, ondemand: [] }, "時間割を作りました"), { accent: true }),
  );
  box.append(inner);
  $wrap.append(box);
}

function renderGrid() {
  const box = document.createElement("section");
  box.className = "tui-box";
  const nowText = now ? `　今：${DAY_NAMES[now.slot.day]} ${now.period.label} ${now.slot.title}` : "";
  box.innerHTML = `<span class="tui-box-title">時間割 — ${folder.name}${nowText}</span>`;
  if (tt.periods.length === 0) {
    box.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "時限がまだありません。上の［例を入れる］か［＋ 時限］で足してください。" }));
    $wrap.append(box);
    return;
  }
  const table = document.createElement("table");
  table.className = "tui-grid";
  table.style.width = "100%";
  const head = table.createTHead().insertRow();
  head.appendChild(document.createElement("th")).style.width = "13ch";
  for (const d of tt.days) head.appendChild(Object.assign(document.createElement("th"), { textContent: DAY_NAMES[d] }));
  const body = table.createTBody();
  tt.periods.forEach((p, r) => {
    const tr = body.insertRow();
    const th = document.createElement("th");
    th.className = "period";
    th.innerHTML = `${p.label}<br><span class="tui-dim">${p.start}-${p.end}</span>`;
    th.title = "右クリックで時限を変える・消す";
    th.oncontextmenu = (e) => menu(e, [
      { id: "edit", label: "時限を変える…", run: () => editPeriod(p) },
      { id: "delete", label: "時限を消す", run: () => deletePeriod(p) },
    ]);
    th.ondblclick = () => editPeriod(p);
    tr.appendChild(th);
    tt.days.forEach((d, c) => {
      const td = tr.insertCell();
      const s = slotAt(r, c);
      if (s) {
        td.append(
          Object.assign(document.createElement("div"), { textContent: s.title || "（授業名なし）" }),
          Object.assign(document.createElement("div"), { className: "tui-dim", textContent: s.folders[0] ? `▸ ${s.folders[0].path.split("\\").pop()}` : "フォルダなし" }),
        );
      } else {
        td.append(Object.assign(document.createElement("div"), { className: "tui-dim", textContent: "·" }));
      }
      if (r === sel.r && c === sel.c) td.classList.add("is-cursor");
      if (now && s && now.slot.day === s.day && now.slot.periodId === s.periodId) td.classList.add("is-now");
      td.title = "ダブルクリックで開く（空のコマなら授業名を入れる）／右クリックでメニュー";
      td.onclick = () => {
        sel = { r, c };
        render();
      };
      td.ondblclick = () => cellActions(r, c).open();
      td.oncontextmenu = (e) => {
        sel = { r, c };
        render();
        menu(e, cellActions(r, c).menu);
      };
    });
  });
  box.append(table);
  $wrap.append(box);
}

function renderOndemand() {
  const box = document.createElement("section");
  box.className = "tui-box";
  box.innerHTML = `<span class="tui-box-title">オンデマンド（曜日・時限の無い授業）</span>`;
  const list = tt.ondemand || [];
  if (list.length === 0) {
    box.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "まだありません。" }));
  }
  for (const o of list) {
    const row = document.createElement("div");
    row.className = "tui-row";
    row.append(
      Object.assign(document.createElement("span"), { textContent: o.title }),
      Object.assign(document.createElement("span"), { className: "tui-grow tui-dim", textContent: o.folders[0] ? `▸ ${o.folders[0].path.split("\\").pop()}` : "フォルダなし" }),
    );
    const setTitle = async () => {
      const title = await ask({ label: "授業名:", value: o.title, okLabel: "決める" });
      if (title) save(withOndemand(o, (x) => ({ ...x, title })));
    };
    row.title = "ダブルクリックで開く／右クリックでメニュー";
    row.ondblclick = () => (o.folders[0] ? openFolder(o.folders[0]) : setTitle());
    row.oncontextmenu = (e) =>
      menu(e, classMenu(o, (folders) => save(withOndemand(o, (x) => ({ ...x, folders }))), setTitle, () => save(withOndemand(o, () => null), "消しました")));
    box.append(row);
  }
  const add = document.createElement("div");
  add.className = "ondemand-add";
  add.append(button("＋ オンデマンドを足す", addOndemand));
  box.append(add);
  $wrap.append(box);
}

function render() {
  $wrap.textContent = "";
  renderToolbar();
  if (!folder) return;
  if (!tt) return renderEmpty();
  sel = { r: Math.max(0, Math.min(sel.r, tt.periods.length - 1)), c: Math.max(0, Math.min(sel.c, tt.days.length - 1)) };
  renderGrid();
  renderOndemand();
}

// ---- キーボード（補助） ----

document.addEventListener("keydown", (ev) => {
  if (!tt || tt.periods.length === 0 || ev.ctrlKey || ev.altKey || ev.target.tagName === "INPUT") return;
  const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
  if (move) {
    sel = { r: sel.r + move[0], c: sel.c + move[1] };
    render();
  } else if (ev.key === "Enter") cellActions(sel.r, sel.c).open();
  else if (ev.key === "F2") cellActions(sel.r, sel.c).setTitle();
  else if (ev.key === "Delete" && slotAt(sel.r, sel.c)) save(withSlot(sel.r, sel.c, () => null), "コマを消しました");
  else return;
  ev.preventDefault();
});

// ---- 今の授業（30秒ごとに確かめる） ----

async function refreshNow() {
  const next = tt ? await ep.timetable.current().catch(() => null) : null;
  const key = (x) => (x ? `${x.slot.day}:${x.slot.periodId}` : "");
  if (key(next) !== key(now)) {
    now = next;
    render();
  }
}

ep.onFolder((f) => {
  const moved = !folder || folder.path !== f.path;
  folder = f;
  if (!moved) render(); // 同じフォルダの読み直し（授業のフォルダを作った、など）
});

// フォルダが変わったとき・時間割が変わったときに届く（ADR 0012）
ep.onTimetable(async (next) => {
  tt = next;
  now = tt ? await ep.timetable.current().catch(() => null) : null;
  // 最初は、今日の曜日の列に合わせる
  const today = tt ? tt.days.indexOf(new Date().getDay()) : -1;
  if (today >= 0 && !document.querySelector(".is-cursor")) sel = { r: 0, c: today };
  render();
});

setInterval(refreshNow, 30_000);
