// MOD 開発ガイドの HTML を、Markdown（mod-docs/guide.md）と見た目（mod-docs/guide.css）から作る（ADR 0020・0021）。
// 作ったものは mod-docs/index.html（アプリに同梱し、ホームの「MOD 開発ガイド」でブラウザに開く）。npm run build:docs
import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";

const read = (name) => readFileSync(new URL(`../mod-docs/${name}`, import.meta.url), "utf8");
const src = read("guide.md");
const css = read("guide.css");

// 見出しに番号の id を付け、左の目次を作る（日本語の見出しでもリンクが壊れないように）
const toc = [];
let n = 0;
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  if (depth === 1) return `<h1>${text}</h1>\n`;
  const id = `s${++n}`;
  if (depth <= 3) toc.push({ depth, id, text: text.replace(/<[^>]+>/g, "") });
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};
// 「入れる人は、…」のような強い注意は、赤い印の引用にする
renderer.blockquote = function ({ tokens }) {
  const body = this.parser.parse(tokens);
  return `<blockquote${body.includes("<strong>入れる人は") ? ' class="warn"' : ""}>${body}</blockquote>\n`;
};

const body = marked.parse(src, { renderer });
const nav = toc.map((h) => `  <a${h.depth === 3 ? ' class="sub"' : ""} href="#${h.id}">${h.text}</a>`).join("\n");

const html = `<!doctype html>
<!-- 自動で作るファイル。直すときは mod-docs/guide.md（見た目は guide.css）を直して npm run build:docs -->
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MOD 開発ガイド — explorer_plus</title>
<style>
${css}</style>
</head>
<body>
<div class="layout">
<nav>
  <div class="brand">explorer_plus MOD</div>
${nav}
</nav>
<main>
${body}</main>
</div>
</body>
</html>
`;
writeFileSync(new URL("../mod-docs/index.html", import.meta.url), html);
console.log(`mod-docs/index.html を作りました（目次 ${toc.length} 項目）`);
