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
| `entry` | ○ | MOD のフォルダの中の `.js` ファイルへの相対パス。`..` と、`/` で始まるパスは不可 |
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

const tree = await ep.getTree({ depth: 2 });          // uses に "tree" が要る
const found = await ep.resolve([{ id, path }]);       // uses に "links" が要る。見つからなければ null
```

### データの形

```ts
type Entry = {
  id: string;          // ファイルID（"<ボリュームの番号16桁>:<ファイルの番号32桁>" の16進数）。名前変更・移動で変わらない
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

知らせの `event`：`folder`（data はフォルダの中身。`onFolder` に届く）、`theme`（data は `"light"` か `"dark"`）。

## 版の決まり

- 本体は、対応している `apiVersion` の範囲を持つ。範囲外の MOD は読み込まず、理由を表示する
- 第1版の約束事は、後から**変えない・消さない**。足すときは、足しても古い MOD が壊れないもの（新しい `uses` の名前、
  新しい method、Entry の新しい省略可能な項目）に限る。壊れる変更が要るときは `apiVersion: 2` を作り、1 も動かし続ける
