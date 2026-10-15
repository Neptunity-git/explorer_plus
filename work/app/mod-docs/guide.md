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
| `settings` | | 設定の項目（30 個まで）。書くと本体が設定の画面を作る（下の「設定」） |
| `network` | | 通信する先（https の origin、10 個まで）。入れるときに利用者に見せる（下の「通信」） |
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
| `folderData` | `folderData`：フォルダについてのデータを、そのフォルダの中に保存する（下の「フォルダの中に保存」） | 軽い |
| `fileContent` | `files.readText`・`readBytes`・`url`：ファイルの中身を読む・画面に出す | 中 |
| `fileInfo` | `files.info`・`properties`：撮影日時・撮影場所・曲名・動画の長さなど | 中 |
| `search` | `search.find`・`stats`：下の階層までの検索と集計 | **重い** |
| `system` | `system.drives`・`info`：ドライブと空き容量・強調色・言語 | 軽い |
| `createFiles` | `files.create`・`createShortcut`：新しいファイル・フォルダ・ショートカットを作る（上書きしない。最初に許可を聞く） | 軽い |
| `collections` | `collections.*`：コレクション（ファイルを場所と関係なく集めたもの）を見る・作る・変える | 軽い |

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

### ファイルの中身（fileContent）

```js
// 文章：文字コード（UTF-8・UTF-16・Shift_JIS）を見分ける。maxBytes は 8MB まで（既定 1MB）
const r = await ep.files.readText(entry);           // { text, size, bytesRead, truncated, encoding }
if (r.truncated) {
  const next = await ep.files.readText(entry, { offset: r.bytesRead });  // 続き
}

// バイト：16MB まで（既定 1MB）
const head = await ep.files.readBytes(entry, { length: 16 });   // Uint8Array

// 画像・動画・音楽をそのまま出す URL（動画・音楽はシークもできる。fetch でも読める）
img.src = await ep.files.url(entry);
video.src = await ep.files.url(movie);
```

- URL は、本体が「渡した項目か」を確かめてから発行する、推測できない使い捨ての URL です。保存しておいて後で使うことはできません（毎回もらってください）
- 3D の模型（.glb）やフォントも、`url` を Three.js のローダーや `@font-face` に渡せば読めます
- OneDrive の「クラウドにだけある」ファイルを読むと、ダウンロードが始まります

### ファイルの詳しい情報（fileInfo）

```js
const [photo, song] = await ep.files.info([entryA, entryB]);
photo.dateTaken;            // 撮影日時（ミリ秒）
photo.latitude;             // 撮影場所（度）
photo.width; photo.height;
song.title; song.artists;   // 曲名・アーティスト（並び）
song.duration;              // 長さ（ミリ秒）

// Windows のプロパティの正式な名前で、ほかの情報も聞ける（エクスプローラの「詳細」と同じもの）
const [p] = await ep.files.properties([entry], ["System.Photo.FNumber", "System.Photo.ISOSpeed"]);
```

Windows が持っている情報を返します（形式を自分で読み解く必要はありません）。一度に 500 個まで。

### 下の階層まで探す・数える（search）

```js
// 名前（* ? が使える）・拡張子・種類・大きさ・日付・中身の文字で探す
const { entries, truncated } = await ep.search.find(folder, { ext: ["jpg", "png"], minSize: 1_000_000 });
const notes = await ep.search.find(folder, { content: "締め切り" }, { limit: 100 });

// 数える：ファイル数・合計の大きさ・拡張子ごと・大きいもの・新しいもの
const s = await ep.search.stats(folder);   // { files, folders, bytes, byExt, largest, newest, truncated }
```

- リンク（ジャンクション）の先へは入りません。数・時間に上限があり、超えると `truncated: true` で途中までを返します
- 中身の検索は文章のファイル（4MB まで）だけ。クラウドにだけあるファイルは見ません（勝手にダウンロードしない）
- 大きなフォルダでは時間がかかります。押したときだけ探す、などにすると軽く保てます

### PC の情報（system）

```js
const drives = await ep.system.drives();   // [{ path: "C:\\", kind: "fixed", label, fileSystem, total, free }]
const { accent, locale } = await ep.system.info();   // Windows の強調色 "#rrggbb"・"ja-JP"
```

### 変化の知らせ（onChanges）

開いているフォルダの直下で、作られた・消えた・名前が変わった・書き換わったときに、1件ずつ届きます（uses に `entries`）。
いっしょに `onFolder` も新しい中身で呼ばれるので、`onChanges` はアニメーション（ポンと出る・崩れて消える）に使うのがおすすめです。

```js
ep.onChanges((changes) => {
  for (const c of changes) {
    if (c.kind === "created") popIn(c.path);
    if (c.kind === "removed") crumble(c.path);
    if (c.kind === "renamed") glow(c.path, c.from);
  }
});
```

### フォルダの中に保存（folderData）

「このフォルダについてのメモや配置」のように、フォルダと一緒に持ち歩きたいデータは、`folderData` でそのフォルダの中に保存できます（uses に `folderData`）。
フォルダの中の隠しフォルダ `.explorer_plus` に入るので、**OneDrive などで同期すると、別の PC の explorer_plus でも同じものが出ます**。フォルダを人に渡すと、データも一緒に渡ります。

```js
ep.onFolder(async (folder) => {
  const data = await ep.folderData.get(folder);        // 無ければ undefined
  // …
  await ep.folderData.set(folder, { layout: [] });      // JSON にできる値。1MB まで
});
await ep.folderData.delete(folder);
```

- 引数の `folder` は、`onFolder` で届いたフォルダ（`{ id, path }` があればよい）。フォルダを移った直後に前のフォルダの分を保存しても、正しいフォルダに入ります
- 書けないフォルダ（`C:\` の直下など）では、代わりにこのビューの保存場所に置きます（`get` で同じように読めます）
- 別の PC ではファイルID が違います。データの中で子フォルダを覚えるときは、ファイルID だけでなく名前も覚えておくと、同期先でも見つけられます

### 新しく作る（createFiles）

```js
const note = await ep.files.create(folder, "メモ.txt", { text: "こんにちは" });
const room = await ep.files.create(folder, "新しい部屋", { kind: "folder" });
const png = await ep.files.create(folder, "スクリーンショット.png", { bytes: pngBytes });   // Uint8Array（16MB まで）
const link = await ep.files.createShortcut(folder, targetEntry);                        // 「元の名前 - ショートカット.lnk」
```

- **新しく作るだけ**です。同じ名前があれば `exists` で失敗し、今あるファイルは書き換えません（消すのは `trash`、名前の変更は `rename`）
- MOD ごとに、**最初に使うとき本体が利用者に許可を聞きます**（断られたら `denied`）。表示中のタブのビューから呼んでください。MOD を外すと許可も消えます
- Windows で使えない名前（`CON`・`?` を含む、など）は `invalid`

### コレクション（collections）

コレクションは、ファイル・フォルダを**実際の場所と関係なく**集めて名前を付けたもの（仮想ディレクトリ）です。アプリ全体で1つで、どの MOD からも同じものが見えます。
中身はファイルID で覚えるので、名前を変えたり動かしたりしても外れません。

```js
const trip = await ep.collections.create("夏の旅行", { color: "#57ab5a" });
await ep.collections.add(trip.id, [photo1, photo2, video]);
const { entries, missing } = await ep.collections.entries(trip.id);   // missing：見つからなくなったもの
const all = await ep.collections.list();                              // [{ id, name, color, count }]
ep.onCollections((list) => redraw(list));
await ep.collections.delete(trip.id);   // 本体が確かめてから消す（中のファイルは消えない）
```

### 本体の画面を使う（ui）

宣言は要りません。お知らせ・確かめ・入力・選択は、**表示中のタブのビューだけ**が出せます（裏のタブから急に画面が出ないように）。

```js
await ep.ui.toast("保存しました");                       // 画面の下に短く（200 文字まで）
await ep.ui.status("3 枚を選択中");                      // 画面の下の状態の欄（null で消す）
await ep.ui.tab({ badge: "12" });                         // タブのバッジ（null で消す）。title でタブの名前も変えられる
const ok = await ep.ui.confirm("並べ替えを元に戻しますか？", { okLabel: "戻す" });   // true / false
const name = await ep.ui.ask({ label: "新しい部屋の名前", value: "部屋 1" });      // 文字 / やめたら null
const id = await ep.ui.choose([{ id: "a", label: "格子に並べる" }, { id: "b", label: "渦に並べる", hint: "たくさんのとき" }]);
```

見た目は本体の確かめの画面と同じで、Esc でやめられます。

### 設定（settings）

manifest に項目を書くと、本体が設定の画面を作ります（タブの `▸`・タブの右クリック・コマンドの一覧から開く）。値は本体が覚えます。

```json
"settings": [
  { "key": "spacing", "label": "間隔", "type": "number", "default": 2, "min": 1, "max": 10, "step": 1 },
  { "key": "layout", "label": "並べ方", "type": "choice", "default": "grid",
    "options": [{ "value": "grid", "label": "格子" }, { "value": "spiral", "label": "渦" }] },
  { "key": "glow", "label": "光らせる", "type": "boolean", "default": true },
  { "key": "tint", "label": "色", "type": "color", "default": "#57ab5a" },
  { "key": "title", "label": "見出し", "type": "text", "default": "", "maxLength": 40 }
]
```

```js
let s = await ep.settings.get();          // { spacing: 2, layout: "grid", glow: true, tint: "#57ab5a", title: "" }
ep.onSettings((next) => { s = next; redraw(); });
```

種類は `boolean`・`number`（`min`・`max`・`step`）・`text`（`maxLength`）・`choice`（`options`）・`color`（`#rrggbb`）。
覚えている値が今の項目に合わなければ（版を上げて項目を変えた、など）、既定の値になります。

### コマンド（commands）

コマンドの一覧（**Ctrl+Shift+P**、またはタブの右クリック）に、このビューのコマンドを出せます。表示中のタブのビューのものが並びます。

```js
await ep.commands.set([
  { id: "shuffle", label: "並べ直す" },
  { id: "export", label: "画像として保存", hint: "PNG" },
]);
ep.onCommand((id) => {
  if (id === "shuffle") shuffle();
});
```

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

- **通信できるのは、自分の MOD のフォルダと、manifest の `network` に書いた先だけ**です（CSP。本体が付けるので MOD からは変えられません）。
  **スクリプトは、通信先からは読み込めません**（コードは MOD のフォルダに入れてください。ライブラリは1つのファイルにまとめると楽です）
- 画像は、自分のフォルダ・アイコンと縮小画像の URL・`data:`・`blob:` が使えます。WebAssembly と Web Worker（`blob:`）も使えます
- ファイルの変更・削除は、必ず本体の API に頼みます。本体は、渡された項目のファイルID が今の場所と合うかを確かめてから行います
- F5・Ctrl+R はページの読み直しではなく、本体の「読み直す」になります。Ctrl・Alt を押したキーは、本体のショートカット（Ctrl+T など）にも届きます
- MOD の管理（`ep.mods`）など、標準のビューだけが使える機能があります。MOD から呼ぶと `denied` になります

> **入れる人は、あなたの MOD を信頼して入れます。** `uses` は必要なものだけにし、何をするビューかを `description` に正直に書いてください。

## 通信（network）

地図のタイル・天気・辞書など、インターネットのデータを使うときは、通信する先を manifest に書きます。

```json
"network": ["https://api.example.com", "https://*.tiles.example.org"]
```

- 書けるのは **https の origin だけ**（`https://名前` と、必要ならポート）。パス・IP アドレス・`localhost` などは書けません。10 個まで
- 書いた先には、`fetch`・画像・音や動画・フォント・スタイルシートで通信できます。**スクリプトは読み込めません**
- 入れる人には、入れる前の確かめの画面で通信先を見せます。ファイルの中身を読める MOD（`fileContent`・`search`）が通信もする場合は、
  「ファイルの中身が外へ送られることがあります」と強く注意が出ます。必要な先だけを書いてください
- MOD の画面は隔離されているので、通信には「どこのページからか（Origin・Referer）」が付きません（Origin は `null`）。
  これを求めるサービス（例：OpenStreetMap の公式のタイル）は使えないことがあります。`fetch` で読むデータは、相手が CORS で許している必要があります
- 版を上げて通信先を増やすと、更新の確かめの画面に「新しく増えた」と出ます

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
