import "./host/styles.css";
import { backend } from "./host/backend";
import { loadViews } from "./host/mods";
import { App } from "./host/shell";
import { logService } from "./host/log-service";
import { getVersion } from "@tauri-apps/api/app";
import { tagService } from "./host/tag-service";
import { timetableService } from "./host/timetable-service";
import { quickAccess, recentItems } from "./host/ref-list-service";

// 本体のログ（ADR 0029）：起動と、本体の画面で起きた思いがけないエラー
window.addEventListener("error", (e) => logService.app("error", `本体のエラー：${e.message}${e.filename ? `（${e.filename}:${e.lineno}）` : ""}`));
window.addEventListener("unhandledrejection", (e) => logService.app("error", `本体のエラー：${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
window.addEventListener("beforeunload", () => void logService.flush());

async function start() {
  void getVersion().then((v) => logService.app("info", `起動しました（explorer_plus ${v}）`), () => logService.app("info", "起動しました"));
  const root = document.getElementById("app")!;
  const [{ views, problems }, places, startDir] = await Promise.all([
    loadViews(),
    backend.listPlaces(),
    backend.devStartDir(),
    tagService.load(),
    timetableService.load(),
    quickAccess.load(),
    recentItems.load(),
  ]);
  if (views.length === 0) {
    root.textContent = "使えるビューがありません。views フォルダを確かめてください。";
    for (const p of problems) console.warn(p.dir, p.errors);
    return;
  }
  for (const p of problems) logService.app("warn", `MOD を読み込めません：${p.dir} — ${p.errors.join(" / ")}`);
  new App(views, problems, places, startDir).mount(root);
}

start().catch((e) => {
  console.error(e);
  document.body.textContent = `起動に失敗しました：${String(e)}`;
});
