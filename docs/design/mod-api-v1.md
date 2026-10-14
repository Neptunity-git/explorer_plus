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

- 足した知らせ：`dragTargets`（data は null）。ドラッグ中にこのビューのタブに切り替わったとき
- ランタイムには `ep.clipboard.copy(entries)`・`cut(entries)`・`paste()`、`ep.drag.start({ items, x, y, targets })`・`ep.drag.targets(targets)`・`ep.onDragTargets(cb)` を足す
