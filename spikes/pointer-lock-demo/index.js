// @ts-check
// ポインターロックの確認用の MOD（ADR 0039）。四角をクリックするとポインターが消えて固定され、動いた量だけが数えられる。
// アプリのホーム →「開発中の MOD を追加」で、このフォルダを選ぶと使える。

const ep = window.explorerPlus;

document.body.style.cssText = "margin:0;font:14px/1.6 system-ui,sans-serif;color-scheme:light dark;display:flex;height:100vh;gap:16px;padding:16px;box-sizing:border-box";
document.body.innerHTML = `
  <div id="pad" style="flex:1;border:2px dashed GrayText;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;cursor:pointer;user-select:none">
    ここをクリックするとロックします<br>（Esc で戻ります）
  </div>
  <div style="width:340px;overflow:auto">
    <h3 style="margin:0 0 8px">状態</h3>
    <div>ロック：<b id="state">OFF</b></div>
    <div>動いた量の合計：x=<span id="x">0</span> y=<span id="y">0</span></div>
    <div>最後の動き：<span id="last">-</span></div>
    <div>最後のキー：<span id="key">-</span></div>
    <div>エラー：<span id="err">-</span></div>
    <h3 style="margin:16px 0 8px">確かめること</h3>
    <ol style="padding-left:20px;margin:0">
      <li>四角をクリック → ポインターが消え、「最後の動き」が変わる</li>
      <li><b>ロック中に Ctrl+W</b> → タブが閉じない。「最後のキー」に Ctrl+w と出る</li>
      <li>ロック中に <b>C</b> → 確かめの画面が出る前に、ロックが外れる</li>
      <li>Esc → ロックが外れる。ロックしていないときの Ctrl+W は、いつもどおりタブを閉じる</li>
      <li>ロック中に、ほかのタブへ切り替える（先にタブを増やしておく）→ 戻るとロックが外れている</li>
    </ol>
  </div>`;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const pad = $("pad");
let x = 0;
let y = 0;

function show() {
  $("state").textContent = document.pointerLockElement === pad ? "ON" : "OFF";
}

pad.addEventListener("click", async () => {
  if (document.pointerLockElement) return;
  $("err").textContent = "-";
  try {
    // 加速を切った生の動きを頼む。使えない環境では、ふつうのロックにする
    await pad.requestPointerLock({ unadjustedMovement: true });
  } catch (e) {
    if (e instanceof Error && e.name === "NotSupportedError") {
      try {
        await pad.requestPointerLock();
      } catch (e2) {
        $("err").textContent = String(e2);
      }
    } else {
      $("err").textContent = String(e);
    }
  }
});

document.addEventListener("pointerlockchange", show);
document.addEventListener("pointerlockerror", () => ($("err").textContent = "pointerlockerror（ロックできませんでした）"));

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== pad) return;
  x += e.movementX;
  y += e.movementY;
  $("x").textContent = String(x);
  $("y").textContent = String(y);
  $("last").textContent = `${e.movementX}, ${e.movementY}`;
});

document.addEventListener("keydown", (e) => {
  $("key").textContent = `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.key}（${document.pointerLockElement ? "ロック中" : "ロックなし"}）`;
  if (e.key === "c" && !e.ctrlKey) {
    // 本体の確かめの画面が出る。ロック中なら、先に本体がロックを外してくれるはず
    void ep.ui.confirm("ロック中でも、この画面のボタンを押せますか？", { okLabel: "押せた" });
  }
});

show();
