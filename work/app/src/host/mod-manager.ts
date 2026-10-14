// MOD を入れる・外す・作る・zip にする（ADR 0020）。ホームビュー（標準のビュー）から mods.* で頼まれる。
// 入れるときは、本体が「何の情報を使う MOD か」を見せて、ユーザーに確かめてから入れる。
import type { Use } from "../api/types";
import { validateManifest } from "../core/manifest";
import { formatSize } from "../core/format";
import { backend, BackendError } from "./backend";
import { confirmDialog } from "./effects";
import type { ModProblem } from "./mods";
import type { LoadedView } from "./view-host";

/** 確かめの画面で見せる、uses の意味 */
const USE_LABELS: Record<Use, string> = {
  entries: "フォルダの中身の一覧（名前・種類）",
  size: "ファイルの大きさ",
  folderSize: "フォルダの大きさ（中身を数える）",
  modified: "更新日時",
  icons: "アイコン",
  tree: "下の階層までのフォルダの形",
  links: "覚えた項目の今の場所",
  tags: "タグ（見る・付ける・作る）",
  timetable: "時間割（見る・書き換える）",
  quickAccess: "クイックアクセス（見る・ピン留めする）",
  recent: "最近使った項目",
  thumbnails: "画像の縮小表示",
};

export type ModInfo = {
  id: string;
  name: string;
  version: string;
  description?: string;
  source: LoadedView["source"];
  uses: Use[];
  location: "folder" | "none";
  dir: string;
};

/** 本体（App）から借りるもの */
export interface ModHost {
  views(): LoadedView[];
  problems(): ModProblem[];
  /** MOD の一覧を読み直す。dirs のフォルダの MOD を使っているタブは、ビューを作り直す */
  reloadViews(dirs?: string[]): Promise<void>;
  openFolder(path: string): void;
  toast(message: string): void;
}

const listeners = new Set<() => void>();
/** 入っている MOD が変わったら知らせる（ホームビューに "mods" の知らせを送るため） */
export function onModsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function changed() {
  for (const cb of listeners) cb();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cancelled = (e: unknown) => e instanceof BackendError && e.apiError.code === "denied";

export class ModManager {
  constructor(private readonly host: ModHost) {}

  list(): { mods: ModInfo[]; problems: ModProblem[] } {
    const mods = this.host.views().map((v) => ({
      id: v.manifest.id,
      name: v.manifest.name,
      version: v.manifest.version,
      description: v.manifest.description,
      source: v.source,
      uses: [...v.manifest.uses],
      location: v.manifest.location ?? "folder",
      dir: v.dir,
    }));
    return { mods, problems: this.host.problems() };
  }

  /** zip を選んでもらって入れる。入れたらその id、やめたら null */
  async install(): Promise<string | null> {
    const zip = await backend.pickModZip();
    return zip ? this.installZip(zip) : null;
  }

  /** zip を調べ、確かめてから入れる（ホームに zip を落としたときも、ここに来る） */
  async installZip(zipPath: string): Promise<string | null> {
    let inspected;
    try {
      inspected = await backend.modInspect(zipPath);
    } catch (e) {
      this.host.toast(`MOD を読めませんでした：${errorText(e)}`);
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(inspected.manifestText);
    } catch {
      raw = null;
    }
    const r = validateManifest(raw, { allowBuiltin: false });
    if (!r.ok) {
      await backend.modDiscard(inspected.staging).catch(() => {});
      this.host.toast(`この MOD は入れられません：${r.errors.slice(0, 3).join(" / ")}`);
      return null;
    }
    const m = r.manifest;
    const lines = [
      inspected.installedVersion ? `「${m.name}」を ${inspected.installedVersion} → ${m.version} に更新しますか？` : `「${m.name}」${m.version} を入れますか？`,
      ...(m.description ? [m.description] : []),
      "",
      m.uses.length ? "このビューが使う情報：" : "このビューは、フォルダの情報を使いません。",
      ...m.uses.map((u) => `・${USE_LABELS[u]}`),
      "",
      "MOD は、ファイルの変更・削除やネットへの通信を自分ではできません（頼まれたときに本体が確かめます）。",
      `ファイル ${inspected.files} 個・${formatSize(inspected.bytes)}　id：${m.id}`,
    ];
    if (!(await confirmDialog(lines.join("\n"), inspected.installedVersion ? "更新する" : "入れる"))) {
      await backend.modDiscard(inspected.staging).catch(() => {});
      return null;
    }
    try {
      const id = await backend.modInstall(inspected.staging);
      await this.host.reloadViews([]);
      changed();
      this.host.toast(`「${m.name}」を入れました。タブの ▸ やホームから使えます`);
      return id;
    } catch (e) {
      this.host.toast(`入れられませんでした：${errorText(e)}`);
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    const info = this.list().mods.find((m) => m.id === id);
    if (!info || info.source === "builtin") throw new BackendError({ code: "not-found", message: `MOD ${id}` });
    const message =
      info.source === "dev"
        ? `開発中の「${info.name}」の読み込みをやめますか？\nフォルダはそのまま残ります。`
        : `「${info.name}」を外しますか？\nMOD のフォルダはごみ箱へ送ります。この MOD が保存していたもの（メモなど）は残るので、入れ直せば続きから使えます。`;
    if (!(await confirmDialog(message, "外す"))) throw new BackendError({ code: "denied", message: "cancelled" });
    await backend.modRemove(id);
    await this.host.reloadViews([]);
    changed();
  }

  async addDev(): Promise<string | null> {
    try {
      const dir = await backend.devModAdd();
      if (!dir) return null;
      await this.host.reloadViews([]);
      changed();
      this.host.toast("開発中の MOD を読み込みました。フォルダの中を保存すると、自動で読み直します");
      return dir;
    } catch (e) {
      if (!cancelled(e)) this.host.toast(`読み込めませんでした：${errorText(e)}`);
      return null;
    }
  }

  /** ひな形から新しい MOD を作り、そのフォルダを開く */
  async createDev(name: string): Promise<string | null> {
    try {
      const dir = await backend.devModCreate(name);
      if (!dir) return null;
      await this.host.reloadViews([]);
      changed();
      this.host.openFolder(dir);
      this.host.toast(`「${name}」のひな形を作りました。index.js を書き換えて保存すると、すぐ反映されます`);
      return dir;
    } catch (e) {
      this.host.toast(`作れませんでした：${errorText(e)}`);
      return null;
    }
  }

  async pack(id: string): Promise<string> {
    const path = await backend.modPack(id);
    this.host.toast(`zip にしました：${path}`);
    return path;
  }

  openFolder(id: string) {
    const info = this.list().mods.find((m) => m.id === id);
    if (!info) throw new BackendError({ code: "not-found", message: `MOD ${id}` });
    this.host.openFolder(info.dir);
  }

  openDocs(): Promise<void> {
    return backend.openModDocs();
  }

  openDevtools(): Promise<void> {
    return backend.openDevtools();
  }

  /** 開発中の MOD のフォルダが保存された：その MOD を読み直す（ホットリロード） */
  private reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  devChanged(dir: string) {
    clearTimeout(this.reloadTimers.get(dir));
    this.reloadTimers.set(
      dir,
      setTimeout(() => {
        this.reloadTimers.delete(dir);
        void this.host.reloadViews([dir]).then(changed);
      }, 250),
    );
  }
}
