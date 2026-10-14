// 標準のビュー「ノート」（ADR 0014 判断4）。フォルダごとに1ページ。
// ノートはこのビューの保存場所（ep.storage）に、フォルダのファイルID ごとに入れる。名前変更・移動しても、同じフォルダのノートが出る。
const ep = window.explorerPlus;

const SAVE_DELAY_MS = 600;

document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.head.appendChild(
  Object.assign(document.createElement("style"), {
    textContent: `
      .page { flex: 1; min-height: 0; display: flex; padding: 14px 10px 4px; }
      .page > .tui-box { flex: 1; }
      textarea {
        flex: 1; resize: none; border: 0; outline: none; padding: 4px 2ch; background: transparent;
        color: var(--tui-fg); font: inherit; line-height: 1.7; user-select: text; tab-size: 4;
      }
      textarea::placeholder { color: var(--tui-dim); }
    `,
  }),
);

document.body.className = "tui";
document.body.innerHTML = `
  <div class="page">
    <section class="tui-box">
      <span class="tui-box-title" id="title">ノート</span>
      <textarea id="text" spellcheck="false" placeholder="このフォルダのメモを書けます。書いたら自動で保存されます。"></textarea>
    </section>
  </div>
  <div class="tui-message" id="message"></div>`;

const $title = document.getElementById("title");
const $text = document.getElementById("text");
const $message = document.getElementById("message");

let key = null; // 今のフォルダのノートの保存キー
let timer = null;
let dirty = false;

/** フォルダのファイルID で覚える（ID の無いドライブではパスで） */
const keyOf = (folder) => `note:${folder.id || folder.path.toLowerCase()}`;

function say(text) {
  $message.textContent = text;
}

async function save() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty || !key) return;
  dirty = false;
  const text = $text.value;
  try {
    if (text.trim() === "") await ep.storage.delete(key);
    else await ep.storage.set(key, { text, updated: Date.now() });
    const t = new Date();
    say(`保存しました（${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}）`);
  } catch (err) {
    dirty = true;
    say(err.code === "too-large" ? "ノートが大きすぎて保存できません（1MB まで）" : `保存できませんでした：${err.message}`);
  }
}

$text.addEventListener("input", () => {
  dirty = true;
  say("書いています…");
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, SAVE_DELAY_MS);
});
// 別のタブ・ウィンドウへ移るときにも保存しておく
$text.addEventListener("blur", save);

ep.onFolder(async (folder) => {
  const next = keyOf(folder);
  if (next === key) return; // 同じフォルダの読み直し（中身が変わった、など）なら、書いている途中を消さない
  await save(); // 前のフォルダのノートを保存してから切り替える
  key = next;
  $title.textContent = `ノート — ${folder.name}`;
  const saved = await ep.storage.get(key).catch(() => undefined);
  $text.value = saved && typeof saved.text === "string" ? saved.text : "";
  say(saved && saved.updated ? `最後の保存：${new Date(saved.updated).toLocaleString("ja-JP")}` : "");
  $text.focus();
});

window.addEventListener("focus", () => $text.focus());
