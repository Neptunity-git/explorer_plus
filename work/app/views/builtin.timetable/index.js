// 標準のビュー「時間割」（ADR 0010・0011）。曜日×時限の表で、今の授業のコマを光らせる。
// 時限（名前・時刻）と曜日は、すべてユーザーが決める（特定の学校に合わせない）。
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
document.body.className = "tui";
document.body.innerHTML = `
  <div class="tui-main">
    <section class="tui-box" style="flex: 3" id="grid-box">
      <span class="tui-box-title" id="grid-title">時間割</span>
      <div class="tui-scroll" id="grid" tabindex="0"></div>
    </section>
    <section class="tui-box" style="flex: 1; min-width: 26ch" id="periods-box">
      <span class="tui-box-title">時限</span>
      <div class="tui-scroll" id="periods" tabindex="0"></div>
    </section>
  </div>
  <div class="tui-message" id="message"></div>
  <footer class="tui-footer" id="keys"></footer>`;

const $grid = document.getElementById("grid");
const $gridTitle = document.getElementById("grid-title");
const $periods = document.getElementById("periods");
const $message = document.getElementById("message");
const $keys = document.getElementById("keys");

let tt = { days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null };
let now = null; // { slot, period } | null
let row = 0; // 時限（periods の番号）
let col = 0; // 曜日（tt.days の番号）
let pane = "grid"; // "grid" | "periods"
let prompt = null;
let confirming = null;

function say(text, isError = false) {
  $message.textContent = text;
  $message.classList.toggle("is-error", isError);
}

const slotAt = (r, c) => {
  const p = tt.periods[r];
  const d = tt.days[c];
  return p && d !== undefined ? tt.slots.find((s) => s.day === d && s.periodId === p.id) || null : null;
};

function clamp() {
  row = Math.max(0, Math.min(row, tt.periods.length - 1));
  col = Math.max(0, Math.min(col, tt.days.length - 1));
}

// ---- 描画 ----

function renderKeys() {
  const k = (key, label) => `<span><span class="tui-key">${key}</span>${label}</span>`;
  if (tt.periods.length === 0) {
    $keys.innerHTML = [k("t", "例（90分×5）を入れる"), k("a", "時限を足す"), k("w", "曜日を切り替え")].join("");
    return;
  }
  $keys.innerHTML =
    pane === "grid"
      ? [k("hjkl", "移動"), k("Enter", "フォルダを開く"), k("e", "授業名"), k("f", "フォルダ"), k("x", "コマを消す"), k("w", "曜日"), k("p", "時限の編集")].join("")
      : [k("j/k", "移動"), k("a", "足す"), k("e", "変える"), k("d", "消す"), k("Esc", "表へ戻る")].join("");
}

function renderGrid() {
  $grid.textContent = "";
  const nowText = now ? `　今：${DAY_NAMES[now.slot.day]} ${now.period.label} ${now.slot.title}` : "";
  $gridTitle.textContent = `時間割${nowText}`;
  if (tt.periods.length === 0) {
    $grid.innerHTML = `<div class="tui-row tui-dim">時限がまだありません。<span class="tui-key">t</span>で例を入れるか、<span class="tui-key">a</span>で足してください。</div>`;
    return;
  }
  const table = document.createElement("table");
  table.className = "tui-grid";
  table.style.width = "100%";
  const head = table.createTHead().insertRow();
  head.appendChild(Object.assign(document.createElement("th"), { textContent: "" })).style.width = "13ch";
  for (const d of tt.days) head.appendChild(Object.assign(document.createElement("th"), { textContent: DAY_NAMES[d] }));
  const body = table.createTBody();
  tt.periods.forEach((p, r) => {
    const tr = body.insertRow();
    const th = document.createElement("th");
    th.innerHTML = `${p.label}<br><span class="tui-dim">${p.start}-${p.end}</span>`;
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
      if (pane === "grid" && r === row && c === col) td.classList.add("is-cursor");
      if (now && s && now.slot.day === s.day && now.slot.periodId === s.periodId) td.classList.add("is-now");
      td.onclick = () => {
        row = r;
        col = c;
        pane = "grid";
        renderAll();
      };
      td.ondblclick = () => openCell();
    });
  });
  $grid.appendChild(table);
}

function renderPeriods() {
  $periods.textContent = "";
  if (tt.periods.length === 0) {
    $periods.innerHTML = `<div class="tui-row tui-dim">なし</div>`;
    return;
  }
  tt.periods.forEach((p, i) => {
    const r = document.createElement("div");
    r.className = "tui-row";
    if (i === row) r.classList.add(pane === "periods" ? "is-selected" : "is-cursor");
    r.append(
      Object.assign(document.createElement("span"), { textContent: p.label }),
      Object.assign(document.createElement("span"), { className: "tui-grow tui-dim", textContent: `${p.start}-${p.end}` }),
    );
    $periods.appendChild(r);
  });
}

function renderAll() {
  clamp();
  renderGrid();
  renderPeriods();
  renderKeys();
  (pane === "grid" ? $grid : $periods).focus();
}

// ---- 保存（本体が検査する。誤りは下の行に出す） ----

async function save(next, done) {
  try {
    tt = await ep.timetable.set(next);
    now = await ep.timetable.current().catch(() => null);
    if (done) say(done);
  } catch (err) {
    say(`保存できませんでした：${(err.message || "").split("\n")[0]}`, true);
  }
  renderAll();
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

// ---- 入力 ----

function ask(label, initial, onDone) {
  $message.classList.remove("is-error");
  $message.textContent = `${label} `;
  const input = Object.assign(document.createElement("input"), { className: "tui-input", value: initial, spellcheck: false });
  input.style.width = "48ch";
  $message.appendChild(input);
  prompt = input;
  input.focus();
  input.select();
  input.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape" || ev.key === "Enter") {
      prompt = null;
      say("");
      if (ev.key === "Enter") onDone(input.value);
      else renderAll();
    }
  };
}

/** "6限 18:00 19:30" の形を読む */
function parsePeriodText(text) {
  const m = /^\s*(\S+)\s+(\d{1,2}:\d{2})\s*[-〜~ ]\s*(\d{1,2}:\d{2})\s*$/.exec(text);
  if (!m) return null;
  const pad = (t) => (t.length === 4 ? `0${t}` : t);
  return { label: m[1], start: pad(m[2]), end: pad(m[3]) };
}

function newPeriodId() {
  let n = tt.periods.length + 1;
  while (tt.periods.some((p) => p.id === `p${n}`)) n++;
  return `p${n}`;
}

// ---- 操作 ----

function openCell() {
  const s = slotAt(row, col);
  if (!s || !s.folders[0]) {
    say("このコマにはフォルダが結びついていません。f でパスを入れるか、ほかのビューでフォルダを右クリック →「時間割のコマに結びつける…」");
    return;
  }
  ep.open(s.folders[0], { newTab: true }).catch(() => say(`フォルダが見つかりません：${s.folders[0].path}`, true));
}

function onGridKey(ev) {
  if (tt.periods.length === 0) return onEmptyKey(ev);
  const s = slotAt(row, col);
  switch (ev.key) {
    case "h":
    case "ArrowLeft":
      col--;
      return renderAll();
    case "l":
    case "ArrowRight":
      col++;
      return renderAll();
    case "k":
    case "ArrowUp":
      row--;
      return renderAll();
    case "j":
    case "ArrowDown":
      row++;
      return renderAll();
    case "Enter":
      return openCell();
    case "e":
      ev.preventDefault();
      return ask("授業名:", s ? s.title : "", (title) => save(withSlot(row, col, (x) => ({ ...x, title }))));
    case "f":
      ev.preventDefault();
      return ask("フォルダのパス（貼り付け可）:", s && s.folders[0] ? s.folders[0].path : "", (path) =>
        save(withSlot(row, col, (x) => ({ ...x, folders: path.trim() ? [{ id: "", path: path.trim().replace(/^"|"$/g, "") }] : [] }))),
      );
    case "x":
      if (s) save(withSlot(row, col, () => null), "コマを消しました");
      return;
    case "w":
      return cycleDays();
    case "p":
      pane = "periods";
      return renderAll();
  }
}

function onEmptyKey(ev) {
  if (ev.key === "t") {
    const periods = EXAMPLE_PERIODS.map(([label, start, end], i) => ({ id: `p${i + 1}`, label, start, end }));
    save({ ...tt, periods }, "例を入れました。p で時限を自由に変えられます");
  } else if (ev.key === "a") {
    ev.preventDefault();
    addPeriod();
  } else if (ev.key === "w") {
    cycleDays();
  }
}

function cycleDays() {
  const i = DAY_SETS.findIndex((set) => set.join() === tt.days.join());
  save({ ...tt, days: DAY_SETS[(i + 1) % DAY_SETS.length] });
}

function addPeriod() {
  ask("時限（名前 始まり 終わり。例：6限 18:00 19:30）:", "", (text) => {
    const p = parsePeriodText(text);
    if (!p) return say("「6限 18:00 19:30」の形で入れてください", true);
    save({ ...tt, periods: [...tt.periods, { id: newPeriodId(), ...p }] });
  });
}

function onPeriodsKey(ev) {
  const p = tt.periods[row];
  switch (ev.key) {
    case "j":
    case "ArrowDown":
      row++;
      return renderAll();
    case "k":
    case "ArrowUp":
      row--;
      return renderAll();
    case "a":
      ev.preventDefault();
      return addPeriod();
    case "e":
      ev.preventDefault();
      if (!p) return;
      return ask("時限（名前 始まり 終わり）:", `${p.label} ${p.start} ${p.end}`, (text) => {
        const q = parsePeriodText(text);
        if (!q) return say("「1限 09:00 10:30」の形で入れてください", true);
        save({ ...tt, periods: tt.periods.map((x) => (x === p ? { ...x, ...q } : x)) });
      });
    case "d": {
      if (!p) return;
      const n = tt.slots.filter((s) => s.periodId === p.id).length;
      confirming = () => save({ ...tt, periods: tt.periods.filter((x) => x !== p), slots: tt.slots.filter((s) => s.periodId !== p.id) });
      say(`時限「${p.label}」を消しますか？${n ? `（この時限のコマ ${n} 個も消えます）` : ""}  y で消す / ほかのキーでやめる`);
      return;
    }
    case "Escape":
    case "h":
    case "ArrowLeft":
      pane = "grid";
      return renderAll();
  }
}

document.addEventListener("keydown", (ev) => {
  if (prompt || ev.ctrlKey || ev.altKey) return;
  if (confirming) {
    const run = confirming;
    confirming = null;
    say("");
    if (ev.key === "y") run();
    return;
  }
  (pane === "grid" ? onGridKey : onPeriodsKey)(ev);
});

// ---- 今の授業（30秒ごとに確かめる） ----

async function refreshNow() {
  const next = await ep.timetable.current().catch(() => null);
  const key = (x) => (x ? `${x.slot.day}:${x.slot.periodId}` : "");
  if (key(next) !== key(now)) {
    now = next;
    renderAll();
  }
}

ep.onTimetable(async (next) => {
  tt = next;
  now = await ep.timetable.current().catch(() => null);
  renderAll();
});

ep.ready().then(async () => {
  tt = await ep.timetable.get();
  now = await ep.timetable.current().catch(() => null);
  // 最初は、今日の曜日の列に合わせる
  const today = tt.days.indexOf(new Date().getDay());
  if (today >= 0) col = today;
  renderAll();
  setInterval(refreshNow, 30_000);
});
