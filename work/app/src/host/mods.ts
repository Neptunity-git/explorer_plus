// 標準のビューとユーザーの MOD を探し、manifest を検査して、使えるビューの一覧を作る。
import { validateManifest } from "../core/manifest";
import { backend } from "./backend";
import type { LoadedView } from "./view-host";

export type ModProblem = { dir: string; errors: string[] };

export async function loadViews(): Promise<{ views: LoadedView[]; problems: ModProblem[] }> {
  const views: LoadedView[] = [];
  const problems: ModProblem[] = [];
  for (const src of await backend.listMods()) {
    if (src.error || src.manifestText === null) {
      problems.push({ dir: src.dir, errors: [src.error ?? "manifest.json: missing"] });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(src.manifestText);
    } catch (e) {
      problems.push({ dir: src.dir, errors: [`manifest.json: ${String(e)}`] });
      continue;
    }
    const r = validateManifest(raw, { allowBuiltin: src.source === "builtin" });
    if (r.ok) views.push({ manifest: r.manifest, source: src.source });
    else problems.push({ dir: src.dir, errors: r.errors });
  }
  return { views, problems };
}
