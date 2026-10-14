# MOD 開発ガイド

explorer_plus に、自分の「ビュー」（フォルダの見せ方）を足すための説明書です。API 第1版（`apiVersion: 1`）。

## MOD とは

explorer_plus は「同じデータを、いろいろなビューで見る」エクスプローラです。Win11 風・ノート・時間割などの標準のビューも、MOD と同じ仕組みで動いています。

- MOD は、**HTML・CSS・JavaScript** で書く小さな Web ページです。ビルドの道具は要りません（使いたければ使えます）
- 本体が、フォルダの中身などのデータを MOD に渡します。MOD は、それを好きなように描きます
- ファイルを開く・名前を変える・ごみ箱へ送るなどの操作は、MOD から**本体に頼みます**。本体が確かめてから行います
- MOD は隔離された箱（sandbox の iframe）の中で動きます。インターネットへの通信や、勝手なファイルの読み書きはできません

## 5分で作る

1. アプリのホームを開き、下の「MOD」の欄で **「ひな形から作る…」** を押す。名前を入れ、作る場所を選ぶ
2. できたフォルダが新しいタブで開き、MOD は**開発中の MOD** として読み込まれる。タブの `▸` から、そのビューに切り替えられる
3. 好きなエディタで `index.js` を書き換えて保存する。**アプリが自動で読み直す**（ホットリロード）。フォルダと戻る・進むの履歴はそのまま
4. できたら、ホームの「MOD」の欄で、その MOD の **「zip にする」** を押す。MOD のフォルダの隣に `id-版.zip` ができる
5. zip を配る。受け取った人は、ホームの **「MOD を入れる」** で選ぶか、ホームのタブに zip を落とすだけで入れられる

> ひな形には `explorer-plus.d.ts`（型の定義）と `jsconfig.json` が入っています。VS Code で開くと `window.explorerPlus` の補完とエラーチェックが効きます。

もう作ってあるフォルダは、「開発中のフォルダを読み込む…」で読み込めます。読み込めない MOD があると、ホームの「MOD」の欄に理由（manifest のどこが違うか）が赤で出ます。

## MOD のフォルダ

```
my-view/
  manifest.json   … MOD の名札
  index.js        … 入口（ES モジュール）。同じフォルダのファイルは相対パスで import できる
  style.css など  … 画像・フォント・ライブラリなど、好きなファイル
```

MOD のファイルは `http://mod.localhost/<MOD の id>/` から配られます。`index.js` から見て `./style.css` のような相対パスで読み込めます。

### manifest.json

```json
{
  "id": "neo.photo-map",
  "name": "写真マップ",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "uses": ["entries", "icons", "thumbnails"],
  "location": "folder",
  "description": "写真を地図の上に並べる"
}
```

| 項目 | 必須 | 決まり |
|---|---|---|
| `id` | ○ | 英小文字・数字・`.`・`-` だけ。3〜64文字。先頭と末尾は英小文字か数字。`builtin.` で始まるものは標準のビュー専用。ほかの人と重ならないよう、`自分の名前.ビューの名前` の形をおすすめします |
| `name` | ○ | 1〜40文字。タブやビューの一覧に出る名前 |
| `version` | ○ | `数字.数字.数字`（例 `1.2.0`）。上げて配ると、入れている人には「更新」として見える |
| `apiVersion` | ○ | `1` |
| `entry` | ○ | 入口の `.js` への相対パス。区切りは `/`（例 `index.js`・`dist/main.js`） |
| `uses` | ○ | 使う情報の名前の配列（空でもよい）。下の表 |
| `location` | | `"folder"`（フォルダを見るビュー。省略時）か `"none"`（フォルダと関係ないビュー。例：タグの一覧） |
| `description` | | 200文字まで。入れるときの確かめの画面に出る |

### 使う情報（uses）

宣言した情報だけが渡され、宣言した機能だけが呼べます。宣言していない機能を呼ぶと、エラー `not-declared` になります。入れる人には、入れる前に「このビューが使う情報」として見せます。**必要なものだけ**を宣言してください。

| 名前 | 渡されるもの・呼べるもの | 重さ |
|---|---|---|
| `entries` | 今のフォルダの中身（名前・種類・拡張子・ファイルID・パス） | 軽い |
| `size` | ファイルの大きさ | 軽い |
| `folderSize` | フォルダの中身の合計の大きさ（後から少しずつ届く） | **重い** |
| `modified` | 更新日時 | 軽い |
| `icons` | Windows のアイコンの URL（`iconUrl`）と種類（`iconKind`） | 軽い |
| `thumbnails` | 画像・動画などの縮小画像の URL（`thumbnailUrl`。`size=` を 32〜256 で変えられる） | 中 |
| `tree` | `getTree()`：今のフォルダから下の階層 | 中 |
| `links` | `resolve()`：保存しておいたファイルID から、今の場所を引く（名前変更・移動に強いリンク） | 軽い |
| `tags` | タグ（見る・付ける・作る）と `onTags`。`Entry.tags` も付く | 軽い |
| `timetable` | 開いている学校のフォルダの時間割（見る・書き換える） | 軽い |
| `quickAccess` | クイックアクセス（見る・ピン留めする） | 軽い |
| `recent` | このアプリで最近開いたファイル | 軽い |

保存（`storage`）、開く・移動・ごみ箱・名前の変更・メニュー・クリップボード・ドラッグは、宣言しなくても使えます。

## API

ランタイムが `window.explorerPlus` を用意します。関数はどれも Promise を返します（`on…` は除く）。`on…` は登録をやめる関数を返します。

### 基本

```js
const ep = window.explorerPlus;

const ctx = await ep.ready();      // { apiVersion, viewId, tabId, theme: "light" | "dark" }

ep.onFolder((folder) => {           // 最初に1回、以後は中身が変わるたびに（ほかのアプリで変わっても）呼ばれる
  // folder: { id, path, name, parentPath, entries: Entry[] }
});

ep.theme;                           // 今の "light" | "dark"
ep.onTheme((theme) => { /* 明るい・暗いが変わった */ });
```

> 同じフォルダの中身が変わったときも `onFolder` が呼ばれます。`folder.path`（または `folder.id`）が前と同じなら、選択やスクロールの位置は保つと使いやすくなります。

### ファイルの操作

```js
await ep.open(entry, { from: el.getBoundingClientRect() });
// ファイルは既定のアプリで開く。フォルダならこのタブで移動。{ newTab: true } で新しいタブに
// from（画面上の位置）を渡すと、本体がそこから開くアニメーションを出す

await ep.navigate("C:\\Users\\me\\Documents");
await ep.navigateUp();

const { trashed } = await ep.trash([entry], { from: rect });  // 本体が確かめてから、ごみ箱へ。やめたら code "denied"
const renamed = await ep.rename(entry, "新しい名前.txt");       // 使えない名前は "invalid"、同じ名前があれば "exists"
const created = await ep.createFolder("資料");                  // 名前を省くと「新しいフォルダー」を作り、
ep.onAction(({ action, entry }) => {                           // 続けて action "rename" が届く（名前の入力を始める合図）
  if (action === "rename") startRename(entry);
});

await ep.tabs.open("builtin.win11", { path: entry.path });     // 別のビューで新しいタブを開く
const views = await ep.views.list();                            // 入っているビューの一覧
```

### 保存

```js
await ep.storage.set("layout", { x: 10, y: 20 });   // このビュー専用。JSON にできる値。1つの値は 1MB まで
const v = await ep.storage.get("layout");           // 無ければ undefined
await ep.storage.delete("layout");
const keys = await ep.storage.keys();
```

> フォルダごとに何かを覚えるときは、キーに `folder.id`（ファイルID）を使うと、フォルダの名前を変えたり動かしたりしても同じものが出ます。ID の無いドライブ（FAT の USB メモリなど）では `id` が空なので、パスで代わりにします：`` const key = `note:${folder.id || folder.path.toLowerCase()}`; ``

### メニュー

```js
el.oncontextmenu = async (e) => {
  e.preventDefault();
  const { chosen } = await ep.showMenu({
    x: e.clientX, y: e.clientY,
    items: [entry],                                   // 選んでいる項目。本体のいつもの項目（名前の変更・圧縮・タグなど）が並ぶ
    extra: [{ id: "star", label: "お気に入りにする" }], // このビューの項目を足せる
  });
  if (chosen === "star") { /* … */ }
};
```

`items` を空にして `extra` だけ渡すと、このビューの項目だけのメニューになります。ブラウザ本来の右クリックのメニューは、ランタイムが止めています。

### クリップボード・ドラッグ

```js
await ep.clipboard.copy([entry]);   // Windows のエクスプローラと同じ形式。エクスプローラにも貼り付けられる
await ep.clipboard.cut([entry]);
const { count } = await ep.clipboard.paste();   // 開いているフォルダへ

// ドラッグ：押したまま少し動いたら start を呼ぶ。そこから先は本体がマウスを追い、
// 落とせる場所（targets・アドレスバー・左の欄・タブ・普通のエクスプローラ）を光らせ、離したら移動・コピーする
el.onpointermove = (e) => {
  if (pressed && moved > 6) ep.drag.start({ items: [entry], x: e.clientX, y: e.clientY, targets: folderTargets() });
};
ep.onDragTargets(() => ep.drag.targets(folderTargets()));   // ドラッグ中にこのタブへ切り替わったとき
// folderTargets() は [{ entry, rect: el.getBoundingClientRect() }, …]（このビューの中で、落とせるフォルダ）
```

### タグ・時間割・ほか

```js
// uses: ["tags"]
const tags = await ep.tags.list();                    // [{ id, name, color: "#rrggbb" }]
const tag = await ep.tags.create("提出物", "#e5484d");
await ep.tags.assign([entry], tag.id);                // 第3引数 false で外す
const tagged = await ep.tags.entries(tag.id);
ep.onTags((tags) => { /* … */ });

// uses: ["timetable"]（開いている学校のフォルダの時間割）
const tt = await ep.timetable.get();                  // 無ければ null
const now = await ep.timetable.current();             // 今の授業 { slot, period } か null
ep.onTimetable((tt) => { /* … */ });

// uses: ["tree"] / ["links"] / ["quickAccess"] / ["recent"]
const tree = await ep.getTree({ depth: 2 });          // { entry, children? }
const found = await ep.resolve([{ id, path }]);       // 見つからなければ null
const pinned = await ep.quickAccess.list();
const recent = await ep.recent.list();
```

すべての関数と型は、ひな形に入っている `explorer-plus.d.ts` にあります。迷ったらそちらが正しいです。

### データの形

```ts
type Entry = {
  id: string;          // ファイルID。名前変更・移動で変わらない（ID の無いドライブでは ""）
  name: string;        // "report.docx"
  path: string;        // "C:\\Users\\me\\report.docx"
  kind: "file" | "folder";
  ext: string;         // 小文字・点なし。フォルダ・拡張子なしは ""
  hidden: boolean;
  size?: number;       // uses に size（フォルダは folderSize）
  modified?: number;   // uses に modified（1970年からのミリ秒）
  iconUrl?: string;    // uses に icons
  iconKind?: "launch" | "config" | "system";
  tags?: string[];     // uses に tags（付いているタグの id）
  thumbnailUrl?: string; // uses に thumbnails
};
type EntryRef = { id: string; path: string };   // 保存しておくときは、この2つだけ覚える
```

`entries` の並びは、フォルダが先、次にファイル。それぞれ名前の自然な順（`file2` が `file10` より前）です。

### エラー

失敗した Promise は `Error` になり、`code` に次のどれかが入ります。

| code | 意味 |
|---|---|
| `not-declared` | `uses` に宣言していない機能を呼んだ |
| `denied` | ユーザーがやめた（ごみ箱の確認など）。または、MOD には使えない機能 |
| `not-found` | ファイル・フォルダが無い |
| `too-large` | 保存の値が 1MB を超えた |
| `invalid` | 引数の形が違う・使えない名前 |
| `exists` | 同じ名前がもうある |
| `io` | 読み書きに失敗した |

```js
try {
  await ep.trash([entry]);
} catch (err) {
  if (err.code !== "denied") showMessage(`ごみ箱へ送れませんでした：${err.message}`);
}
```

## 見た目（TUI キット）

標準のビューと同じ見た目の部品を使えます（使わなくてもかまいません）。明るい・暗い画面にも自動で合います。

```js
// CSS：色の変数（--tui-fg・--tui-dim・--tui-line・--tui-accent・--tui-warn・--tui-bg）と部品のクラス
document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/__runtime/tui.css" }));
document.body.className = "tui";

// 部品：tui-box（枠と見出し）・tui-row（行）・tui-button・tui-input・tui-grid（表）・tui-footer（キーの説明）など
document.body.innerHTML = `
  <section class="tui-box"><span class="tui-box-title">一覧</span><div class="tui-scroll" id="list"></div></section>`;

// JS の部品：入力・選択・色選び・確認の小さな画面
import { ask, pick, pickColor, confirm, button, PALETTE } from "/__runtime/tui.js";
const name = await ask({ label: "名前", okLabel: "作る" });          // やめたら null
```

操作は**マウス（左右のクリック）が主、キーボードは補助**、がこのアプリの考え方です。ダブルクリックで開く・右クリックでメニュー、を基本にすると、ほかのビューと同じ手触りになります。

## 安全の決まり

- **通信できるのは自分の MOD のフォルダだけ**です（CSP。本体が付けるので MOD からは変えられません）。インターネット上のライブラリ・フォント・画像は読めません。使うものは MOD のフォルダに入れてください（ライブラリは1つのファイルにまとめると楽です）
- 画像は、自分のフォルダ・アイコンと縮小画像の URL・`data:`・`blob:` が使えます。WebAssembly と Web Worker（`blob:`）も使えます
- ファイルの変更・削除は、必ず本体の API に頼みます。本体は、渡された項目のファイルID が今の場所と合うかを確かめてから行います
- F5・Ctrl+R はページの読み直しではなく、本体の「読み直す」になります。Ctrl・Alt を押したキーは、本体のショートカット（Ctrl+T など）にも届きます
- MOD の管理（`ep.mods`）など、標準のビューだけが使える機能があります。MOD から呼ぶと `denied` になります

> **入れる人は、あなたの MOD を信頼して入れます。** `uses` は必要なものだけにし、何をするビューかを `description` に正直に書いてください。

## 配る

1. `manifest.json` の `version` を上げる（初めてなら `1.0.0` など）
2. ホームの「MOD」の欄で「zip にする」を押す。`node_modules`・`.git`・`.vscode`・zip と、作る人だけが使うファイル（`MOD開発ガイド.md`・`explorer-plus.d.ts`・`jsconfig.json`）は入りません
3. できた `id-版.zip` を配る。受け取った人は、ホームの「MOD を入れる」か、ホームのタブに zip を落として入れる

zip は、一番上に `manifest.json` があるか、一番上のフォルダ1つの中にある形にしてください（どちらでも入ります）。中のファイルは 2000 個・合わせて 50MB までです。

同じ `id` の MOD を入れると「更新」になります。古いフォルダはごみ箱へ送られ、MOD が保存していたもの（`storage`）は引き継がれます。外しても保存したものは残るので、入れ直せば続きから使えます。

## ヒント

- **開発者ツール**：ホームの「MOD」の欄の「開発者ツール」で開けます。MOD のエラーや `console.log` は、そこのコンソールに出ます（上の「top」を自分の MOD の `__frame.html` に切り替えると、MOD の中で式を試せます）
- **大きなフォルダ**：`entries` が数千になることがあります。全部を DOM にせず、見えている所だけ描くと軽くなります
- **ライブラリ**：Three.js などは、npm で入れて esbuild などで1つのファイルにまとめ、MOD のフォルダに置きます。`entry` を `dist/main.js` にしても大丈夫です
- **アニメーション**：`ep.open(entry, { from })` の `from` を渡すと、本体の「開く」演出がその位置から出ます
- **アイデア**：写真を撮った日で並べる年表、容量の大きいものを大きく描くマップ、フォルダを部屋にした 3D、課題の締め切りボード…
