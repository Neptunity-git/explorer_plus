# explorer_plus の MOD

このフォルダが 1 つの MOD（ビュー）です。

1. `index.js` を書き換えて保存する → アプリが自動で読み直します（開発中の MOD として読み込んでいるとき）
2. `manifest.json` の `name`・`description`・`uses`（使う情報）を、作るビューに合わせて直す
3. できたら、アプリのホーム →「MOD」→ この MOD の「zip にする」で、配れる zip ができます

詳しくは、同じフォルダの「MOD開発ガイド.html」をブラウザで開いてください。
エディタ（VS Code など）で開くと、`explorer-plus.d.ts` のおかげで `window.explorerPlus` の補完が効きます。
