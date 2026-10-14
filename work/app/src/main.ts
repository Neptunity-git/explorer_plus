import "./host/styles.css";
import { backend } from "./host/backend";
import { loadViews } from "./host/mods";
import { App } from "./host/shell";

async function start() {
  const root = document.getElementById("app")!;
  const [{ views, problems }, places, startDir] = await Promise.all([loadViews(), backend.listPlaces(), backend.devStartDir()]);
  if (views.length === 0) {
    root.textContent = "使えるビューがありません。views フォルダを確かめてください。";
    for (const p of problems) console.warn(p.dir, p.errors);
    return;
  }
  new App(views, problems, places, startDir).mount(root);
}

start().catch((e) => {
  console.error(e);
  document.body.textContent = `起動に失敗しました：${String(e)}`;
});
