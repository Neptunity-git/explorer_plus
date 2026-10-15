import "./host/styles.css";
import { backend } from "./host/backend";
import { loadViews } from "./host/mods";
import { App } from "./host/shell";
import { logService } from "./host/log-service";
import { getVersion } from "@tauri-apps/api/app";
import { onSync, windowLabel } from "./host/sync";
import { collectionService, grantService } from "./host/collection-service";
import { settingsService } from "./host/mod-ui";
import { forgetStorage } from "./host/view-storage";

/** ほかのウィンドウで保存されたら、このウィンドウでも読み直す（ADR 0030） */
function watchOtherWindows() {
  onSync((m) => {
    if (m.kind === "log") logService.addRemote(m.entry);
    else if (m.kind === "viewStorage") forgetStorage(m.viewId);
    else if (m.kind === "appData") {
      const reload: Record<string, () => Promise<void>> = {
        tags: () => tagService.reload(),
        timetables: () => timetableService.reload(),
        quickaccess: () => quickAccess.reload(),
        recent: () => recentItems.reload(),
        settings: () => settingsService.reload(),
        collections: () => collectionService.reload(),
        grants: () => grantService.reload(),
      };
      void reload[m.name]?.().catch((e) => console.warn("reload failed", m.name, e));
    }
  });
}
import { tagService } from "./host/tag-service";
import { timetableService } from "./host/timetable-service";
import { quickAccess, recentItems } from "./host/ref-list-service";

// 本体のログ（ADR 0029）：起動と、本体の画面で起きた思いがけないエラー
window.addEventListener("error", (e) => logService.app("error", `本体のエラー：${e.message}${e.filename ? `（${e.filename}:${e.lineno}）` : ""}`));
window.addEventListener("unhandledrejection", (e) => logService.app("error", `本体のエラー：${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
window.addEventListener("beforeunload", () => void logService.flush());

async function start() {
  if (windowLabel === "main") void getVersion().then((v) => logService.app("info", `起動しました（explorer_plus ${v}）`), () => logService.app("info", "起動しました"));
  else logService.app("info", "ウィンドウを開きました");
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
  // 新しいウィンドウ（ADR 0030）は、開く場所とビューを URL で受け取る。最初のウィンドウは、開発中の試験用のフォルダ（ふだんは無し）
  const q = new URLSearchParams(location.search);
  const firstDir = q.get("path") ?? (windowLabel === "main" ? startDir : null);
  new App(views, problems, places, firstDir, q.get("view")).mount(root);
  watchOtherWindows();
}

start().catch((e) => {
  console.error(e);
  document.body.textContent = `起動に失敗しました：${String(e)}`;
});
