// @ts-check
// explorer_plus の MOD のひな形：今のフォルダのファイルを大きい順に並べ、大きさを棒で見せる。
// このファイルを書き換えて保存すると、アプリが自動で読み直す（開発中の MOD のとき）。
// 説明書：同じフォルダの「MOD開発ガイド.md」。補完が効くのは explorer-plus.d.ts と jsconfig.json のおかげ。

const ep = window.explorerPlus;

// 見た目の部品（TUI 風）と、このビューの見た目を読み込む
document.head.append(
  Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }),
  Object.assign(document.createElement("link"), { rel: "stylesheet", href: "./style.css" }),
);
document.body.className = "tui";
document.body.innerHTML = `
  <div class="tui-main">
    <section class="tui-box" style="flex: 1">
      <span class="tui-box-title" id="title">大きい順</span>
      <div class="tui-scroll" id="list"></div>
    </section>
  </div>
  <div class="tui-footer"><span class="tui-key">ダブルクリック</span>開く <span class="tui-key">右クリック</span>メニュー</div>`;

const $title = /** @type {HTMLElement} */ (document.getElementById("title"));
const $list = /** @type {HTMLElement} */ (document.getElementById("list"));

/** 1.2 MB のような読みやすい大きさにする */
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

// フォルダを開いたとき・中身が変わったときに呼ばれる
ep.onFolder((folder) => {
  $title.textContent = `大きい順 — ${folder.name}`;
  const files = folder.entries.filter((e) => e.kind === "file" && !e.hidden).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  const max = Math.max(1, ...files.map((e) => e.size ?? 0));
  $list.textContent = "";
  if (files.length === 0) {
    $list.append(Object.assign(document.createElement("div"), { className: "tui-row tui-dim", textContent: "ファイルがありません" }));
  }
  for (const entry of files) {
    const row = document.createElement("div");
    row.className = "tui-row";
    const icon = Object.assign(document.createElement("img"), { className: "icon", src: entry.iconUrl ?? "", alt: "" });
    const bar = Object.assign(document.createElement("div"), { className: "bar" });
    bar.style.width = `${((entry.size ?? 0) / max) * 100}%`;
    const cell = Object.assign(document.createElement("div"), { className: "bar-cell" });
    cell.append(bar);
    row.append(
      icon,
      Object.assign(document.createElement("span"), { className: "tui-grow", textContent: entry.name }),
      Object.assign(document.createElement("span"), { className: "size", textContent: formatSize(entry.size ?? 0) }),
      cell,
    );
    // 開くのは本体に頼む（既定のアプリで開く）
    row.ondblclick = () => ep.open(entry, { from: row.getBoundingClientRect() });
    // 右クリックのメニューも本体が出す（名前の変更・タグなど、いつもの項目が並ぶ）
    row.oncontextmenu = (e) => {
      e.preventDefault();
      void ep.showMenu({ x: e.clientX, y: e.clientY, items: [entry] });
    };
    $list.append(row);
  }
});
