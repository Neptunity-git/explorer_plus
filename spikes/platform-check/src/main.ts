// 技術の確認用の試作（ADR 0006 判断2）。本番のコードではない。
import { invoke } from "@tauri-apps/api/core";

type Row = { item: string; ok: boolean; detail: unknown };
const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

function addRow({ item, ok, detail }: Row) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${item}</td><td class="${ok ? "ok" : "ng"}">${ok ? "OK" : "NG"}</td><td><pre></pre></td>`;
  tr.querySelector("pre")!.textContent = JSON.stringify(detail, null, 2);
  document.querySelector("#results tbody")!.appendChild(tr);
}

async function check(item: string, key: string, run: () => Promise<unknown>, isOk: (r: any) => boolean) {
  try {
    const r = await run();
    report[key] = r;
    addRow({ item, ok: isOk(r), detail: r });
  } catch (e) {
    report[key] = { error: String(e) };
    addRow({ item, ok: false, detail: String(e) });
  }
}

// ---- 6. MOD の閉じ込め ----
// MOD に見立てたスクリプトが、Tauri の機能・親の画面・ネットに触れられるかを試し、結果を親へ postMessage で返す。
const probe = `
<script>
const r = { steps: [], violations: [] };
document.addEventListener('securitypolicyviolation', (e) => r.violations.push(e.violatedDirective + ' ' + e.blockedURI));
window.addEventListener('error', (e) => r.steps.push('error: ' + e.message));
const send = () => parent.postMessage({ type: 'mod-report', name: NAME, r }, '*');
setTimeout(() => { r.steps.push('partial (6s)'); send(); }, 6000);
(async () => {
  r.steps.push('start');
  r.origin = String(self.origin);
  r.hasTauriGlobal = typeof window.__TAURI__ !== 'undefined';
  r.hasTauriInternals = typeof window.__TAURI_INTERNALS__ !== 'undefined';
  if (r.hasTauriInternals) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej('no answer within 3s'), 3000));
    try { await Promise.race([window.__TAURI_INTERNALS__.invoke('check_file_id'), timeout]); r.invokeViaInternals = 'ALLOWED'; }
    catch (e) { r.invokeViaInternals = 'blocked: ' + e; }
  }
  try { r.parentDocument = typeof window.parent.document.body; } catch (e) { r.parentDocument = 'blocked: ' + e.name; }
  try { r.parentTauri = typeof window.parent.__TAURI__; } catch (e) { r.parentTauri = 'blocked: ' + e.name; }
  r.steps.push('before internet');
  try { await fetch('https://example.com', { mode: 'no-cors' }); r.internet = 'ALLOWED'; }
  catch (e) { r.internet = 'blocked: ' + e.message; }
  r.steps.push('before ipc');
  try {
    const res = await fetch('http://ipc.localhost/check_file_id', { method: 'POST', body: '{}',
      headers: { 'Content-Type': 'application/json', 'Tauri-Callback': '1', 'Tauri-Error': '2' } });
    r.ipcFetch = 'reached, status ' + res.status;
  } catch (e) { r.ipcFetch = 'blocked: ' + e.message; }
  try { localStorage.setItem('x', '1'); r.localStorage = 'ALLOWED'; } catch (e) { r.localStorage = 'blocked: ' + e.name; }
  r.steps.push('done');
  send();
})();
<\/script>`;

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:">`;

function runModProbe(name: string, withCsp: boolean): Promise<any> {
  return new Promise((resolve) => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "mod-report" && ev.data.name === name) {
        window.removeEventListener("message", onMsg);
        resolve(ev.data.r);
      }
    };
    window.addEventListener("message", onMsg);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = (withCsp ? csp : "") + probe.replace("NAME", JSON.stringify(name));
    iframe.title = name;
    document.querySelector("#mods")!.appendChild(iframe);
    setTimeout(() => resolve({ error: "timeout (iframe から返事がない)" }), 15000);
  });
}

// 閉じ込めが効いている = 実際に Tauri の機能を呼べず、親の画面にも触れられない（ネットは CSP ありのときだけ遮断を期待）。
// iframe の中に __TAURI__ などの入り口が「見えている」こと自体は、呼べなければ害はないので合否には含めず、詳細に残す。
function modIsolated(r: any, expectNetBlocked: boolean): boolean {
  if (r.error) return false;
  const noTauri = r.invokeViaInternals !== "ALLOWED" && !String(r.ipcFetch).includes("status 200");
  const noParent = String(r.parentDocument).startsWith("blocked") && String(r.parentTauri).startsWith("blocked");
  const net = expectNetBlocked ? String(r.internet).startsWith("blocked") : true;
  return noTauri && noParent && net;
}

async function drawIcon(ext: string) {
  const icon: any = await invoke("get_icon", { ext, jumbo: true });
  const canvas = document.createElement("canvas");
  canvas.width = icon.width;
  canvas.height = icon.height;
  canvas.title = `.${ext}（${icon.width}x${icon.height}）`;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
  const fig = document.createElement("figure");
  fig.appendChild(canvas);
  fig.insertAdjacentHTML("beforeend", `<figcaption>.${ext}</figcaption>`);
  document.querySelector("#icons")!.appendChild(fig);
  // 全部透明なら取り出しに失敗している
  const visible = icon.rgba.some((v: number, i: number) => i % 4 === 3 && v > 0);
  return { ext, width: icon.width, height: icon.height, visible };
}

window.addEventListener("DOMContentLoaded", async () => {
  await check("1. 位置情報", "geolocation", () => invoke("check_geolocation"), (r) => r.access === "Allowed" && r.accuracy_m != null);
  await check("2. ファイルID（名前変更・移動で不変）", "fileId", () => invoke("check_file_id"), (r) => r.same_file && r.same_folder);
  await check("3. ごみ箱へ送る", "trash", () => invoke("check_trash"), (r) => r.gone_from_folder && r.found_in_recycle_bin);
  await check(
    "4. 標準アイコン",
    "icons",
    async () => {
      const out = [];
      for (const ext of ["docx", "pptx", "xlsx", "pdf", "txt", "exe", "json", "zip"]) out.push(await drawIcon(ext));
      return out;
    },
    (r) => r.every((i: any) => i.visible),
  );
  // 開発中の自動再読み込みのたびにメモ帳が開かないよう、2回目以降は飛ばす
  if (!localStorage.getItem("openChecked")) {
    await check("5. 既定のアプリで開く", "open", () => invoke("check_open"), (r) => typeof r === "string");
    localStorage.setItem("openChecked", "1");
  }
  await check("6a. MOD の閉じ込め（CSP なし）", "modNoCsp", () => runModProbe("no-csp", false), (r) => modIsolated(r, false));
  await check("6b. MOD の閉じ込め（CSP あり）", "modCsp", () => runModProbe("csp", true), (r) => modIsolated(r, true));
  report.finishedAt = new Date().toISOString();
  const path = await invoke("save_report", { json: JSON.stringify(report, null, 2) });
  document.querySelector("#saved")!.textContent = `結果を保存しました：${path}`;
});
