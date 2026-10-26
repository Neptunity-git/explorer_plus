// @ts-check
// 共有フォルダの記録の確認用の MOD（ADR 0040）。開いているフォルダに一言ずつ書き足し、全員の分を読む。
// アプリのホーム →「開発中の MOD を追加」で、このフォルダを選ぶ。OneDrive の中のフォルダを開き、ビューをこれに変えて使う。

const ep = window.explorerPlus;

document.body.style.cssText = "margin:0;font:14px/1.6 system-ui,sans-serif;color-scheme:light dark;display:flex;height:100vh;gap:16px;padding:16px;box-sizing:border-box";
document.body.innerHTML = `
  <div style="flex:1;display:flex;flex-direction:column;min-width:0">
    <form id="form" style="display:flex;gap:8px;margin-bottom:8px">
      <input id="text" maxlength="200" placeholder="一言（Enter で書き足す）" style="flex:1;font:inherit;padding:4px 8px">
      <button style="font:inherit">書き足す</button>
    </form>
    <div id="list" style="flex:1;overflow:auto;border:1px solid GrayText;border-radius:6px;padding:4px 8px"></div>
  </div>
  <div style="width:340px;overflow:auto">
    <h3 style="margin:0 0 8px">状態</h3>
    <div>自分：<span id="me">（まだ書いていない）</span></div>
    <div>記録の数：<span id="count">0</span>（書いた人 <span id="authors">0</span>）</div>
    <div>署名が合わず読まなかった行：<span id="rejected">0</span></div>
    <div>最後の知らせ（onFolderLog）：<span id="event">-</span></div>
    <div>エラー：<span id="err">-</span></div>
    <h3 style="margin:16px 0 8px">確かめること</h3>
    <ol style="padding-left:20px;margin:0">
      <li>初めて書き足す → 許可の画面、続けて表示名の画面が出る</li>
      <li>書き足した一言が一覧に出る（自分の分は太字）</li>
      <li>同じフォルダを別のタブ・ウィンドウでも開く → 片方で書くと、5 秒ほどで、もう片方に出る</li>
      <li>OneDrive の別の PC で同じフォルダを開く → 同期のあと、相手の一言が出る（名前が違う ID で出る）</li>
      <li>フォルダの中の .explorer_plus\\log.neo.folder-log-demo\\…\\*.jsonl をメモ帳で開き、文字を1つ変えて保存 → その行が消え、「読まなかった行」が増える</li>
      <li>Ctrl+Shift+P →「自分の表示名とアイコン…」で名前を変える → 「自分」が変わる（前に書いた一言の名前は変わらない）</li>
    </ol>
  </div>`;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const input = /** @type {HTMLInputElement} */ ($("text"));

/** @type {ExplorerPlus.EntryRef | null} */
let world = null;
/** @type {Map<string, ExplorerPlus.FolderLogRecord>} */
let records = new Map();
/** @type {string | undefined} */
let cursor;
let rejected = 0;
let myId = "";

const showError = (/** @type {unknown} */ e) => ($("err").textContent = e instanceof Error ? `${/** @type {any} */ (e).code ?? ""} ${e.message}` : String(e));

function draw() {
  const list = $("list");
  list.replaceChildren();
  const sorted = [...records.values()].sort((a, b) => a.t - b.t);
  for (const r of sorted) {
    const d = /** @type {{ text?: unknown; by?: unknown; icon?: unknown }} */ (r.data ?? {});
    const row = document.createElement("div");
    row.style.cssText = `padding:2px 0;${r.author === myId ? "font-weight:bold" : ""}`;
    const who = `${typeof d.icon === "string" ? d.icon + " " : ""}${typeof d.by === "string" ? d.by : "（名前なし）"}`;
    row.textContent = `${new Date(r.t).toLocaleString()}  ${who}［${r.author.slice(0, 8)}］  ${String(d.text ?? "")}`;
    list.append(row);
  }
  list.scrollTop = list.scrollHeight;
  $("count").textContent = String(records.size);
  $("authors").textContent = String(new Set(sorted.map((r) => r.author)).size);
  $("rejected").textContent = String(rejected);
}

async function pull() {
  const folder = world;
  if (!folder) return;
  try {
    let r;
    do {
      r = await ep.folderLog.read(folder, { since: cursor });
      if (folder !== world) return;
      for (const rec of r.records) records.set(rec.id, rec);
      rejected += r.rejected;
      cursor = r.cursor;
      myId = r.me;
    } while (r.more);
    draw();
  } catch (e) {
    showError(e);
  }
}

ep.onFolder((folder) => {
  if (world && world.path === folder.path) return;
  world = { id: folder.id, path: folder.path };
  records = new Map();
  cursor = undefined;
  rejected = 0;
  pull();
});

ep.onFolderLog(() => {
  $("event").textContent = new Date().toLocaleTimeString();
  pull();
});

const showMe = (/** @type {ExplorerPlus.Identity} */ me) => ($("me").textContent = `${me.icon ?? ""} ${me.name ?? "（名前なし）"}［${me.id.slice(0, 8)}］`);
ep.onIdentity(showMe);

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !world) return;
  try {
    const me = await ep.identity.get();
    showMe(me);
    const rec = await ep.folderLog.append(world, { text, by: me.name, icon: me.icon });
    records.set(rec.id, rec);
    myId = rec.author;
    input.value = "";
    draw();
  } catch (err) {
    showError(err);
  }
});
