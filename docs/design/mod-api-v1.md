# ビュー MOD の API（第1版）

ADR 0002・0005・0007 を、実装できる形の約束事にしたもの。本体（ホスト）と MOD の両方がこの文書に従う。
型の正本は `work/app/src/api/types.ts`。この文書と食い違ったら、文書を直してから型を直す。

## 全体の形

```
┌─ 本体の画面（Tauri の WebView）──────────────────────────────┐
│  タブ │ アドレスバー │ ビューの切り替え                          │
│  ┌─ iframe（sandbox="allow-scripts"、出どころ null）────────┐  │
│  │  ランタイム（本体が入れる。window.explorerPlus を作る）    │  │
│  │  MOD の index.js（ES モジュール）                          │  │
│  └──────────────── postMessage ─────────────────────────────┘  │
│  ビューホスト：メッセージの送り主・権限を確かめ、Rust を呼ぶ     │
└────────────────────────────── invoke ──────────────────────────┘
   Rust：フォルダの一覧、ファイルID、アイコン、開く、ごみ箱、MOD のファイルの配信
```

- MOD のファイルは、本体の独自の通信先 `http://mod.localhost/<MOD の id>/` から配る。iframe はそこの
  `__frame.html`（本体が作るページ。ランタイムと index.js を読み込む）を開く
- そのページには本体が CSP を**応答ヘッダで**付ける（MOD が書き換えられない）。許すのは自分の MOD のフォルダ、
  アイコンの配信先、`data:`・`blob:`、ランタイムのインラインスクリプトだけ。インターネットと Tauri の通信口には出られない
  （`spikes/platform-check/RESULTS.md`）
- 本体は、メッセージの送り主が「その iframe の window」かを `event.source` で確かめる（出どころが null なので origin では確かめられない）

## MOD のフォルダ

```
my-view/
  manifest.json
  index.js        … 入口（ES モジュール）。同じフォルダのファイルは相対パスで import できる
  （CSS・画像・ライブラリのファイルなど、好きなもの）
```

### manifest.json

```json
{
  "id": "neo.voxel-chest",
  "name": "ボクセルチェスト",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "uses": ["entries", "size", "icons"],
  "description": "フォルダをチェストにして並べる"
}
```

| 項目 | 必須 | 決まり |
|---|---|---|
| `id` | ○ | 英小文字・数字・`.`・`-` だけ。3〜64文字。先頭と末尾は英小文字か数字。`builtin.` で始まる id は標準のビュー専用 |
| `name` | ○ | 1〜40文字 |
| `version` | ○ | `数字.数字.数字` |
| `apiVersion` | ○ | 整数。第1版は `1` |
| `entry` | ○ | MOD のフォルダの中の `.js` ファイルへの相対パス。区切りは `/` だけ（`\` と `:` は不可）。`/` で始まらず、区切った部分に空・`.`・`..` が無い（例：`index.js`、`dist/main.js`） |
| `uses` | ○ | 下の「使う情報」の名前の配列（空でもよい）。知らない名前があればエラー。重複は1つにまとめる |
| `description` | | 200文字まで |

### 使う情報（`uses`）

宣言した情報だけが渡され、宣言した機能だけが呼べる（ADR 0002 判断4）。宣言していない機能を呼ぶと、エラー `not-declared` で失敗する。

| 名前 | 渡されるもの・呼べるもの | 重さ |
|---|---|---|
| `entries` | 今のフォルダの中身（名前・種類・拡張子・ファイルID・パス） | 軽い |
| `size` | ファイルの大きさ | 軽い |
| `folderSize` | フォルダの中身の合計の大きさ（後から届く） | **重い** |
| `modified` | 更新日時 | 軽い |
| `icons` | Windows の標準アイコンと、独自アイコンの種類（`iconUrl`・`iconKind`） | 軽い |
| `tree` | `getTree()`：今のフォルダから下の階層 | 中 |
| `links` | `resolve()`：保存しておいたファイルID から、今の場所を引く（名前変更・移動に強いリンク） | 軽い |

自分の構造の保存（`storage`）、開く・移動・ごみ箱（`open` など）は、宣言しなくても使える。

## ランタイム（MOD から見える `window.explorerPlus`）

```ts
const ep = window.explorerPlus;

const ctx = await ep.ready();            // { apiVersion, viewId, tabId, theme: "light" | "dark" }

const stop = ep.onFolder((folder) => {   // 最初に1回、以後は中身が変わるたびに呼ばれる
  // folder: { path, name, parentPath, entries: Entry[] }
});

await ep.open(entry, { from: rect });    // ファイルは既定のアプリで開く。フォルダならこのタブで移動。
                                         // from（画面上の位置）を渡すと、本体がそこからアニメーションを出す
await ep.navigate("C:\\Users\\neo_m\\Documents");
await ep.navigateUp();
const r = await ep.trash([entry], { from: rect });   // 本体が確認してから、ごみ箱へ送る。r: { trashed: number }

await ep.storage.set("chests", data);    // このビュー専用の保存場所（JSON にできる値）。1つの値は 1MB まで
const data = await ep.storage.get("chests");          // 無ければ undefined
await ep.storage.delete("chests");
const keys = await ep.storage.keys();

const renamed = await ep.rename(entry, "新しい名前.txt");   // 名前の変更。新しい Entry が返る
const folder = await ep.createFolder();              // 今のフォルダに「新しいフォルダー」を作る。続けて本体から action（rename）が届く
const { chosen } = await ep.showMenu({ x, y, items: selectedEntries, extra: [{ id: "pin", label: "チェストに入れる" }] });
                                                     // 右クリックのメニューを本体が出す。標準の項目（開く・ごみ箱など）は本体が実行し、
                                                     // extra の項目が選ばれたときだけ chosen にその id が入る（それ以外は null）
const stop2 = ep.onAction(({ action, entry }) => { /* action === "rename"：その項目の名前の変更を始める */ });

const tree = await ep.getTree({ depth: 2 });          // uses に "tree" が要る
const found = await ep.resolve([{ id, path }]);       // uses に "links" が要る。見つからなければ null
```

### データの形

```ts
type Entry = {
  id: string;          // ファイルID（"<ボリュームの番号16桁>:<ファイルの番号32桁>" の16進数）。名前変更・移動で変わらない。
                       // ファイルID の無いドライブ（FAT の USB メモリなど）では ""（そのファイルへのリンクは、パスでしか探せない）
  name: string;        // "report.docx"
  path: string;        // "C:\\Users\\neo_m\\report.docx"
  kind: "file" | "folder";
  ext: string;         // 小文字・点なし。"docx"。拡張子が無い・フォルダなら ""
  hidden: boolean;
  size?: number;       // バイト。uses に size（フォルダは folderSize）があるときだけ
  modified?: number;   // 1970年からのミリ秒。uses に modified があるときだけ
  iconUrl?: string;    // uses に icons があるときだけ
  iconKind?: "launch" | "config" | "system";  // 独自アイコンの種類（ADR 0003）。system は Windows の標準アイコンを使う
};
```

- `entries` の並び順は、フォルダが先、次にファイル。それぞれ名前の自然な順（Windows のエクスプローラと同じく、
  大文字小文字を区別せず、`file2` が `file10` より前）
- `iconKind`：拡張子が `exe`・`bat`・`cmd`・`lnk`・`msi` なら `launch`（押しボタン）、`json`・`yaml`・`yml`・`toml`・`ini`・`cfg`・
  `conf`・`xml` なら `config`（歯車）、それ以外とフォルダは `system`

### エラー

失敗した Promise は `Error` を返し、`code` に次のどれかが入る。

| code | 意味 |
|---|---|
| `not-declared` | manifest の `uses` に宣言していない機能を呼んだ |
| `denied` | ユーザーが断った（ごみ箱の確認で「やめる」など） |
| `not-found` | ファイル・フォルダが無い |
| `too-large` | storage の値が 1MB を超えた |
| `invalid` | 引数の形が違う |
| `io` | 読み書きに失敗した |
| `exists` | 同じ名前のファイル・フォルダが既にある（名前の変更・フォルダの作成）。2026-10-14 に追加 |

## 本体と MOD のあいだのメッセージ（ランタイムの中身。MOD 作者は気にしなくてよい）

すべて `postMessage` で、次の形のオブジェクトを送る。`ep` は約束事の版で、第1版は `1`。

| 向き | 形 |
|---|---|
| MOD → 本体（呼び出し） | `{ ep: 1, kind: "call", id: 正の整数, method: 文字列, params: オブジェクト }` |
| 本体 → MOD（返事） | `{ ep: 1, kind: "result", id: 呼び出しの id, ok: true, value: 任意 }` または `{ ep: 1, kind: "result", id, ok: false, error: { code, message } }` |
| 本体 → MOD（知らせ） | `{ ep: 1, kind: "event", event: 文字列, data: 任意 }` |
| MOD → 本体（キー） | `{ ep: 1, kind: "key", key: 文字列, ctrl: 真偽, shift: 真偽, alt: 真偽 }`（Ctrl・Alt を押しながらのキーだけ。本体のショートカットを、MOD にフォーカスがあっても効かせるため） |

呼び出しの `method` と、要る宣言：

| method | params | 要る `uses` |
|---|---|---|
| `ready` | `{}` | なし |
| `open` | `{ id, path, from? }` | なし |
| `navigate` | `{ path }` | なし |
| `navigateUp` | `{}` | なし |
| `trash` | `{ items: [{ id, path }], from? }` | なし |
| `storage.get` / `storage.set` / `storage.delete` / `storage.keys` | `{ key }` / `{ key, value }` / `{ key }` / `{}` | なし |
| `getTree` | `{ depth }`（1〜5） | `tree` |
| `resolve` | `{ refs: [{ id, path }] }`（100件まで） | `links` |
| `rename` | `{ id, path, newName }`（newName は 1〜255 文字） | なし |
| `createFolder` | `{}` | なし |
| `showMenu` | `{ x, y, items: [{ id, path }]（0〜1000件）, extra?: [{ id, label }]（0〜20件。id は 1〜64 文字、label は 1〜60 文字） }`。x・y は iframe の中の座標 | なし |

`rename`・`createFolder`・`showMenu` と、知らせの `action`、エラーの `exists` は 2026-10-14 に追加した（ADR 0009）。

ref の `id` は空文字でもよい（ファイルID の無いドライブのため）。本体は、ID が取れるファイルについては ID の一致を確かめる。

知らせの `event`：`folder`（data はフォルダの中身。`onFolder` に届く）、`theme`（data は `"light"` か `"dark"`）、
`action`（data は `{ action: "rename", entry }`。`onAction` に届く）。

### 名前の決まり（rename・createFolder）

Windows と同じ。本体が確かめ、守っていなければ `invalid`：空・空白だけは不可、255 文字まで、`\ / : * ? " < > |` と制御文字は不可、
末尾の空白・`.` は不可、予約された名前（`CON`・`PRN`・`AUX`・`NUL`・`COM1`〜`COM9`・`LPT1`〜`LPT9`。大文字小文字を問わず、`con.txt` のように拡張子が付いても不可）は不可。

## 版の決まり

- 本体は、対応している `apiVersion` の範囲を持つ。範囲外の MOD は読み込まず、理由を表示する
- 第1版の約束事は、後から**変えない・消さない**。足すときは、足しても古い MOD が壊れないもの（新しい `uses` の名前、
  新しい method、Entry の新しい省略可能な項目）に限る。壊れる変更が要るときは `apiVersion: 2` を作り、1 も動かし続ける

## タグと時間割（2026-10-14 に追加。ADR 0010）

タグと時間割は、アプリ全体で1つ。使う MOD は manifest の `uses` に `tags`・`timetable` を宣言する（宣言していない MOD には、
一覧も変更の知らせも届かず、呼ぶと `not-declared`）。

```ts
// タグ（uses に "tags"）
const tags = await ep.tags.list();                         // Tag[]：{ id, name, color: "#rrggbb" }
const tag = await ep.tags.create("重要", "#e5484d");          // 名前が重なれば exists
await ep.tags.update(tag.id, { name: "最重要", color: "#ff0000" });
await ep.tags.delete(tag.id);                              // そのタグは、付いていたすべての項目から外れる
await ep.tags.assign([entry], tag.id, true);               // true で付ける、false で外す
const tagged = await ep.tags.entries(tag.id);              // そのタグが付いた項目（Entry[]。見つからなくなったものは除く）
ep.onTags((tags) => { /* タグの一覧が変わった */ });
// uses に "tags" があると、Entry に tags（付いているタグの id の配列）が入る

// 時間割（uses に "timetable"）
const tt = await ep.timetable.get();                       // Timetable：{ days, periods, slots, place }
await ep.timetable.set(newTimetable);                      // 本体が検査する。誤りがあれば invalid（message に誤りの一覧）
const now = await ep.timetable.current();                  // { slot, period } か null（今の時刻と、設定していれば場所で決める）
ep.onTimetable((tt) => { /* 時間割が変わった */ });
```

| method | params | 要る `uses` |
|---|---|---|
| `tags.list` | `{}` | `tags` |
| `tags.create` | `{ name, color }`（name は 1〜40 文字、color は `#rrggbb`） | `tags` |
| `tags.update` | `{ id, name?, color? }`（name か color の少なくとも一方） | `tags` |
| `tags.delete` | `{ id }` | `tags` |
| `tags.assign` | `{ items: [{ id, path }]（1〜1000件）, tagId, on: boolean }` | `tags` |
| `tags.entries` | `{ tagId }` | `tags` |
| `timetable.get` | `{}` | `timetable` |
| `timetable.set` | `{ timetable }` | `timetable` |
| `timetable.current` | `{}` | `timetable` |

知らせの `event` に `tags`（data は Tag[]）と `timetable`（data は Timetable）を足す。

### 時間割の決まり

- `days`：表に出す曜日（0=日曜 … 6=土曜）。`periods`：時限（id・表示名・`"HH:MM"` の始まりと終わり。20 個まで）。
  `slots`：コマ（曜日・時限の id・授業名・結びつけるフォルダ 0〜5 個）。同じ曜日・時限のコマは1つまで。
  `place`：`null` か `{ latitude, longitude, radius }`（「この場所にいるときだけ今の授業を出す」）
- 今の授業：今の曜日と時刻（始まりを含み、終わりを含まない）に合う時限を、`periods` の順に見て、その曜日のコマがある最初のもの。
  `place` を設定していて、位置が取れたときだけ、`radius ＋ 位置の誤差` より遠ければ「今の授業なし」。位置が取れないときは時刻だけで決める

## 2026-10-14（2回目）の変更（ADR 0012・0014。公開前なので意味を変えたものがある）

- **時間割はフォルダごと**（ADR 0012）：`timetable.get` は、ビューが開いているフォルダの時間割（無ければ `null`）。`timetable.set` はそのフォルダに保存、
  `timetable.delete` はそのフォルダの時間割を消す、`timetable.current` はそのフォルダの時間割での今の授業。知らせの `timetable` は、
  時間割が変わったときと、フォルダが変わったときに届く（data は `Timetable | null`）
- 時間割に `ondemand`（省略可能）：`[{ id, title, folders }]`。曜日・時限の無い授業
- manifest に `location`（省略可能）：`"folder"`（既定）か `"none"`（フォルダと関係ない。タブでアドレスバーを隠す）
- `FolderSnapshot` に `id`（フォルダ自身のファイルID）
- `uses` に `thumbnails`：Entry に `thumbnailUrl`（Windows の縮小画像）
- `createFolder` に `name`（省略可能）
- 足した呼び出し：

| method | params | 要る `uses` | 返すもの |
|---|---|---|---|
| `timetable.delete` | `{}` | `timetable` | なし |
| `views.list` | `{}` | なし | `ViewInfo[]`（`{ id, name, description?, location }`） |
| `tabs.open` | `{ viewId, path?, replace? }` | なし | なし（新しいタブを開く。replace: true ならこのタブで開く） |
| `quickAccess.list` | `{}` | `quickAccess` | `Entry[]`（ピン留めしたフォルダ） |
| `quickAccess.pin`・`quickAccess.unpin` | `{ items: [{ id, path }] }`（1〜100件） | `quickAccess` | なし |
| `recent.list` | `{}` | `recent` | `Entry[]`（最近開いた項目、新しい順） |

- 足した知らせ：`quickAccess`・`recent`（data は null。中身は list で取り直す）

## 2026-10-14（3回目）の追加（ADR 0015）

- 時間割のコマ・オンデマンドに `memo`（省略可能、0〜200 文字）
- 足した呼び出し（どれも `uses` の宣言は不要）：

| method | params | 返すもの |
|---|---|---|
| `clipboard.copy`・`clipboard.cut` | `{ items: [{ id, path }] }`（1〜1000件） | なし（Windows のクリップボードに、エクスプローラと同じ形式で入る） |
| `clipboard.paste` | `{}` | `{ count }`（ビューが開いているフォルダへ貼り付けた数。Windows の画面で進み具合・名前の重なりを扱う） |
| `drag.start` | `{ items, x, y, targets: [{ id, path, x, y, width, height }] }` | なし。そこから先は本体がマウスを追い、落としたら移動・コピーする |
| `drag.targets` | `{ targets }` | なし（本体から `dragTargets` の知らせが来たら、落とせる場所を知らせ直す） |
| `drag.move`・`drag.end` | `{ x, y, ctrl, shift }`・`{ x, y, ctrl, shift, cancel }` | なし。ドラッグ中のマウスの動き。ランタイムが自動で送るので、MOD は呼ばなくてよい（iframe の中で押したボタンの動きは、離すまでその iframe に届くため） |

- 足した知らせ：`dragTargets`（data は null）。ドラッグ中にこのビューのタブに切り替わったとき
- ランタイムには `ep.clipboard.copy(entries)`・`cut(entries)`・`paste()`、`ep.drag.start({ items, x, y, targets })`・`ep.drag.targets(targets)`・`ep.onDragTargets(cb)` を足す

## 2026-10-15 の追加（ADR 0020）

### MOD の管理（標準のビューだけ）

id が `builtin.` で始まる標準のビュー（ホーム）だけが使える。ほかの MOD が呼ぶと `denied`。MOD 作者向けの説明書には載せない。

| メソッド | 引数 | 返り値 |
|---|---|---|
| `mods.list` | なし | `{ mods: [{ id, name, version, description?, source: "builtin" \| "user" \| "dev", uses, location, dir }], problems: [{ dir, errors }] }` |
| `mods.install` | なし | `{ id: string \| null }`（本体が zip を選ぶ画面と確かめの画面を出す。やめたら null） |
| `mods.remove` | `{ id }` | なし（本体が確かめる。やめたら `denied`） |
| `mods.addDev` | なし | `{ dir: string \| null }` |
| `mods.createDev` | `{ name }`（1〜40文字） | `{ dir: string \| null }` |
| `mods.pack` | `{ id }`（開発中の MOD） | `{ path }` |
| `mods.openFolder` | `{ id }` | なし |
| `mods.openDocs`・`mods.openDevtools` | なし | なし |

知らせ `mods`（data は null）：入っている MOD が変わった（入れた・外した・開発中の MOD が保存された）。標準のビューだけに届く。

### ほかの変更

- 開発中の MOD（`source: "dev"`）：本体に登録した任意の場所のフォルダ。保存すると、その MOD を使っているタブのビューを作り直す
- 作者向けの説明書：`work/app/mod-docs/index.html`（アプリに同梱）

## 2026-10-15（2回目）の追加（ADR 0022）

### フォルダの中に置くデータ（uses に `folderData`）

| メソッド | 引数 | 返り値 |
|---|---|---|
| `folderData.get` | `{ folder: EntryRef }` | 保存した値。無ければ undefined |
| `folderData.set` | `{ folder: EntryRef, value }`（JSON にできる値。1MB まで） | なし |
| `folderData.delete` | `{ folder: EntryRef }` | なし |

- 置き場所は `folder` の中の `.explorer_plus/view.<ビューの id>.json`（`.explorer_plus` は隠しフォルダ）。OneDrive などで同期すれば、別の PC でも同じものが出る
- `folder` のファイルID が今のものと合わなければ（別のものに入れ替わった）失敗する。書けないフォルダでは、このビューの保存場所（キー `folderData:<ファイルID かパス>`）に置く
- 本体は `.explorer_plus` と、隠し＋システムの項目（desktop.ini など）を、フォルダの一覧（entries）に入れない。ほかの隠し項目は `hidden: true` で入れる

## 2026-10-15（3回目）の追加：読み取りの API（ADR 0023）

| uses | メソッド | 引数 | 返り値 |
|---|---|---|---|
| `fileContent` | `files.readText` | `{ item, offset?=0, maxBytes?=1MB（8MB まで） }` | `{ text, size, bytesRead, truncated, encoding }`（UTF-8・UTF-16・Shift_JIS を見分ける） |
| `fileContent` | `files.readBytes` | `{ item, offset?=0, length?=1MB（16MB まで） }` | Uint8Array |
| `fileContent` | `files.url` | `{ item }` | `http://epfile.localhost/<推測できない印>/<名前>`。Range に対応。MOD の CSP の img・media・connect・font で許す |
| `fileInfo` | `files.info` | `{ items }`（500 まで） | `(FileInfo \| null)[]`（Windows のプロパティから。時間はミリ秒） |
| `fileInfo` | `files.properties` | `{ items, names }`（"System.*" を 60 まで） | `(名前→値 \| null)[]` |
| `search` | `search.find` | `{ folder, query, depth?=64, limit?=1000（5000 まで） }` | `{ entries, truncated }` |
| `search` | `search.stats` | `{ folder, depth? }` | `{ files, folders, bytes, byExt, largest, newest, truncated }` |
| `system` | `system.drives`・`system.info` | なし | ドライブの一覧・`{ accent, locale }` |

- 知らせ `changes`（data は `FileChange[]`）：開いているフォルダの直下の変化。uses に `entries` のあるビューだけ。`folder` の知らせの後に届く
- たどるときは、リンクの先へ入らず、`.explorer_plus` と隠し＋システムの項目を数えない。上限（30 万項目・20 秒）で `truncated`

## 2026-10-15（4回目）の追加：本体の画面を使う API（ADR 0024）

uses の宣言は要らない。

| メソッド | 引数 | 返り値・決まり |
|---|---|---|
| `ui.toast` | `{ text }`（200 文字まで） | 表示中のタブのビューだけ。0.3 秒に1回まで（ほかは黙って捨てる） |
| `ui.status` | `{ text \| null }`（120 文字まで） | 画面の下の状態の欄（「n 個の項目」の横）。タブごとに覚える |
| `ui.tab` | `{ title?: 文字 \| null（40 文字まで）, badge?: 文字 \| null（8 文字まで） }` | null で元に戻す・消す。省略は変えない |
| `ui.confirm` | `{ message（500 文字まで）, okLabel? }` | true / false |
| `ui.ask` | `{ label, value?, placeholder?, okLabel? }` | 文字 / null |
| `ui.choose` | `{ title?, items: [{ id, label, hint? }]（200 個まで） }` | 選んだ id / null |
| `settings.get` | なし | manifest の settings の値（覚えている値を今の項目に合わせたもの） |
| `commands.set` | `{ commands: [{ id, label, hint? }]（50 個まで） }` | コマンドの一覧（Ctrl+Shift+P）に出す |

- confirm・ask・choose は表示中のタブのビューだけ、同時に1つまで（ほかは `denied`）
- 知らせ `settings`（data は値）：設定の画面で保存した。知らせ `command`（data は `{ id }`）：コマンドの一覧で選ばれた
- manifest の `settings`：`{ key（英字で始まる英数字と _、32 文字まで）, label（40 文字まで）, type, default, ... }` を 30 個まで。
  type は `boolean`・`number`（`min`・`max`・`step`）・`text`（`maxLength` 200 まで）・`choice`（`options` 2〜30 個）・`color`（`#rrggbb`）
- 値はアプリのデータ `settings`（ビューの id ごと）に置く
- 本体とランタイムは、WebView2 自身のショートカット（Ctrl+P・Ctrl+Shift+P の印刷、Ctrl+F・F3・Ctrl+G のページ内検索、Ctrl+S・Ctrl+U・Ctrl+J・Ctrl+H）を止める。MOD 自身のキーの処理には影響しない

## 2026-10-15（5回目）の追加：書き込みとコレクション（ADR 0025）

| uses | メソッド | 引数 | 返り値・決まり |
|---|---|---|---|
| `createFiles` | `files.create` | `{ folder, name, kind?="file", text? \| bytes?（16MB まで） }` | Entry。同じ名前があれば `exists`（上書きしない）。Windows で使えない名前は `invalid` |
| `createFiles` | `files.createShortcut` | `{ folder, target, name? }` | Entry（.lnk）。name 省略は「元の名前 - ショートカット」 |
| `collections` | `collections.list` | なし | `[{ id, name, color, count }]` |
| `collections` | `collections.create`・`update` | `{ name, color? }`・`{ id, name?, color? }` | Collection。名前は 1〜60 文字で重ならない（大文字・小文字を区別しない）。色は `#rrggbb` |
| `collections` | `collections.delete` | `{ id }` | 本体が確かめる（やめたら `denied`）。中のファイルは消えない |
| `collections` | `collections.add`・`remove` | `{ id, items }`（1〜1000） | なし。重ねて入れない |
| `collections` | `collections.entries` | `{ id }` | `{ entries, missing }`。名前変更・移動したものは今の場所で返し、覚えているパスも直す |

- `createFiles` の許可：標準のビュー以外は、MOD ごとに最初に使うとき本体が確かめの画面を出す（表示中のタブのビューだけ）。許可はアプリのデータ `grants` に覚え、MOD を外すと消す
- コレクションはアプリ全体で1つ（アプリのデータ `collections`）。200 個まで、1つに 10000 項目まで。知らせ `collections`（data は一覧）

## 2026-10-15（6回目）の追加：通信（ADR 0026）

- manifest の `network`：https の origin（`https://name`・`https://*.name`・ポート付き）を 10 個まで。パス・IP アドレス・`localhost`・`.local` などは不可。
  検査は TypeScript（`src/core/network.ts`）と Rust（`mods.rs` の `valid_origin`）の両方で行い、CSP は Rust が作る
- CSP：`style-src`・`img-src`・`font-src`・`connect-src`・`media-src` に通信先を足す。`script-src` には足さない
- 入れるときの確かめの画面に通信先を出す。`fileContent`・`search` を使う MOD なら「ファイルの中身が外へ送られることがある」、ほかの uses があれば「名前などが送られることがある」と注意を出す。更新で増えた先には「新しく増えた」
- ホームの MOD の一覧に「通信あり」

## 2026-10-15（7回目）の追加：本体が代わりに通信する・API キー（ADR 0027）

- `net.fetch(url, { method, headers, body | json, secret })`：本体（Rust、`netproxy.rs`）が通信して、Response に似た形で返す。uses は要らない（network が要る）
  - 宛先は manifest の network に当てはまる https の URL だけ（IP アドレス・利用者名つきは不可）。転送は自分で1回ずつ確かめる（5 回まで）
  - 名前を引いた住所が PC の中・家の中（private・loopback・link-local など）なら通信しない
  - User-Agent は `explorer_plus/<版> (MOD <id>; ...)`。Cookie・User-Agent・Referer・Origin・Host・Proxy-*・Sec-* などは MOD が付けられない。Set-Cookie は返さない
  - 送る 4MB・受け取る 16MB・30 秒。4xx・5xx は結果として返す。つながらないときはエラー `network`（ERROR_CODES に追加）
  - Rust からの結果は `[説明の長さ 4 バイト][説明の JSON][中身]` の1つのバイト列（`parseNetFrame`）
- `net.url(url, { secret })`：`http://epnet.localhost/<印>` を発行する（同じ URL には同じ印。4000 個まで）。GET だけ。HTML・JS・XML は text/plain にして返す。
  CSP の img・font・connect・media に、network のある MOD だけ `http://epnet.localhost` を足す（script には足さない）
- settings の `type: "secret"`：`send: { origin, header, prefix? } | { origin, query }`。origin は network にある * の無いもの
  - 値は Windows の資格情報マネージャー（`explorer_plus:<id>:<key>`。開発中のアプリは `explorer_plus-dev:`）。settings.json には書かない
  - settings.get・onSettings では、預けてあるかの true / false だけ
  - 設定の画面ではパスワードの欄（今の値は見せない。書いたときだけ預け直す。「消す」）
  - 本体は send.origin と同じ origin への通信のときだけ付ける。query のときは MOD が書いた同じ名前を除き、MOD に返す URL にも残さない
  - 入れるときの確かめの画面に「○○は本体が預かり、<origin> だけに送る」。MOD を外すと消す
- 検査は TypeScript（`settings.ts`）と Rust（`mods.rs` の `secrets_of`）の両方で行う

## 2026-10-15（8回目）の追加：ログ（ADR 0029）

- ランタイムは `console.log`・`info`・`debug`（情報）・`warn`（警告）・`error`（エラー）と、受け止めなかったエラー（`error`・`unhandledrejection`）を、
  `{ ep: 1, kind: "log", level, text }` で本体へ送る（開発者ツールのコンソールにも、これまでどおり出る）。本体は 1 件 2000 文字まで、MOD ごとに 10 秒に 100 件まで
- 本体は、標準でない MOD が頼んだこと（通信・開く・ごみ箱・名前の変更・作る・コピー・ドラッグ・コレクション・タグ）と、断ったこと（エラーの code と説明）を、その MOD のログに残す。
  通信の URL は `?` より後を書かない。秘密の値は書かない
- 本体のログ（source "app"）：起動・ファイルを変える操作・開く・MOD の出し入れ・その失敗・本体の画面のエラー
- ファイル：アプリのデータの `logs/app.log`・`logs/mod.<id>.log`（1行1件の JSON。1MB で `.old.log` へ入れ替え）
- 標準のビューだけが使える：`logs.list({ source })`・`logs.sources()`・`logs.clear({ source })`・知らせ `logs`（1件ずつ。フォルダと関係ない標準のビューだけに届く）・`mods.openSettings({ id })`。`mods.list` の各 MOD に `hasSettings`

## 2026-10-15（9回目）の追加：ウィンドウ（ADR 0030）

- 知らせ `folderData`（data は `{ path }`）・`ep.onFolderData(cb)`：開いているフォルダのこのビューのデータ（folderData）を、ほかのウィンドウが書き換えた。uses に folderData があるビューだけに届く
- ビューごとの保存（storage）・設定・タグなどは、本体がウィンドウのあいだで合わせる（MOD は何もしなくてよい）

## 2026-10-15（9回目）の追加：getTree の from（ADR 0032）

- `getTree` の params に省略可能な `from`（`{ id, path }`）。そのフォルダを根にして返す。省略すると今までどおり今のフォルダから
- `from` のフォルダが無ければ `not-found`、ID が今のものと完全に合わなければ `not-found`（空の ID は、ID の無いドライブのフォルダにだけ通る。本体から渡された場所しか読めないように）
- 深さ 1〜5、1回にフォルダ 500 個まで、は同じ。要る `uses` も `tree` のまま

## 2026-10-22 の追加：ほかのビューの右クリックのメニューに出す（ADR 0036）

- manifest の `menu`：`[{ id（1〜64文字、重なりなし）, label（1〜60文字）, for?（"file"・"folder"・"background" の空でない並び。省略は3つとも）,
  ext?（小文字・点なしの拡張子 [a-z0-9]{1,16} の空でない並び。for を書くなら "file" が要る）, multiple?（boolean）, run?（"open"・"background"） }]` を 20 個まで
- 本体は、右クリックのメニューに「MOD の名前 ›」を出し、横のメニューに当てはまる項目を並べる。出すのは
  ファイル・フォルダを選んで右クリック（選んだものが全部 for・ext・multiple に合うとき）と、フォルダを見るビューの空いている所（extra が無いとき）。
  今のタブのビュー自身の項目は出さない
- 知らせ `menu`（data は `{ id, items: Entry[], folder: { id, path } | null }`）・`ep.onMenu(cb)`（受け取り口を作る前に届いた分も渡す）
- run が `"open"`：MOD のビューを今のタブの右に新しいタブで開き（フォルダは今のタブのもの）、準備ができてフォルダを送った後に `menu` を送る
- run が `"background"`：大きさ 0 の見えない iframe で動かす。`ready` の返事に `background: true`（ビューのときは false）
  - `menu.done`（params なし、uses 不要）で本体が止める。ほかに、API の呼びかけも返事待ちも無いまま 30 秒、または始めて 10 分で止める
  - `navigate`・`navigateUp`・`showMenu`・`drag.*`・`clipboard.paste`・name の無い `createFolder` は `denied`。`ui.status`・`ui.tab` は何もしない
  - `ui.toast`・`ui.confirm` などは、表示中のタブでなくても出せる。`open` のフォルダは新しいタブで開く。ほかは右クリックしたタブに頼む
  - MOD ごとに1つ。動いている間に選ばれたら、同じものに `menu` を送る。MOD の一覧を読み直したら止める
