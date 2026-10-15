// 時間割（ADR 0010・0012・0022）。学校のフォルダごとに持つ。
// 時間割そのものは、学校のフォルダの中（.explorer_plus/timetable.json）に置く。OneDrive などで同期すれば、別の PC でも同じ時間割が出る。
// この PC のアプリのデータには「どのフォルダに時間割があるか」の一覧だけを置く（「今の授業」をすぐ出すため）。
// 一覧に無いフォルダでも、開いたときに時間割のファイルがあれば一覧に足す（別の PC で作った時間割を見つける）。
// 検査は src/core/timetable.ts、登録簿の操作と「今の授業」は src/core/timetables.ts、ファイルの形は src/core/timetable-file.ts に任せる。
import type { CurrentClass, EntryRef, Timetable } from "../api/types";
import { validateTimetable } from "../core/timetable";
import { fromTimetableFile, toTimetableFile } from "../core/timetable-file";
import { currentClass } from "../core/timetable-now";
import { allCurrent, emptyRegistry, findTimetable, putTimetable, removeTimetable, type NowClass, type TimetableRegistry } from "../core/timetables";
import { backend, BackendError, type Location } from "./backend";

/** 位置は、この間だけ覚えておく（場所の条件を使う時間割があるときだけ取る） */
const LOCATION_TTL_MS = 5 * 60 * 1000;
/** フォルダの中のデータの名前 */
const FILE = "timetable";

/** 以前の形（時間割をアプリのデータに丸ごと置いていた）か */
function looksLikeRegistry(v: unknown): v is TimetableRegistry {
  return !!v && typeof v === "object" && Array.isArray((v as TimetableRegistry).entries);
}

/** 今の形（時間割のあるフォルダの一覧だけ） */
type FolderList = { v: 2; folders: EntryRef[] };
function looksLikeFolderList(v: unknown): v is FolderList {
  return !!v && typeof v === "object" && (v as FolderList).v === 2 && Array.isArray((v as FolderList).folders);
}

const isRef = (r: unknown): r is EntryRef =>
  !!r && typeof r === "object" && typeof (r as EntryRef).path === "string" && typeof (r as EntryRef).id === "string";

/** 結びつけたフォルダのファイルID が空なら、パスから引いて埋める（別の PC から来た時間割・名前変更に強くするため） */
async function fillIds(tt: Timetable) {
  const missing = [...tt.slots.flatMap((s) => s.folders), ...(tt.ondemand ?? []).flatMap((o) => o.folders)].filter((f) => f.id === "");
  if (missing.length === 0) return;
  const ids = await backend.fileIds(missing.map((f) => f.path)).catch(() => missing.map(() => ""));
  missing.forEach((f, i) => (f.id = ids[i] ?? ""));
}

class TimetableService {
  private reg: TimetableRegistry = emptyRegistry();
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private location: { at: number; value: Location | null } | null = null;

  load(): Promise<void> {
    this.loading ??= (async () => {
      const text = await backend.appDataLoad("timetables").catch(() => null);
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // 壊れていたら空から始める
      }
      let refs: EntryRef[] = [];
      // 以前の形の時間割は、学校のフォルダの中へ移す
      const legacy = new Map<string, unknown>();
      if (looksLikeFolderList(parsed)) refs = parsed.folders.filter(isRef);
      else if (looksLikeRegistry(parsed)) {
        for (const e of parsed.entries) {
          if (!e || !isRef({ id: String(e.folder?.id ?? ""), path: e.folder?.path })) continue;
          refs.push({ id: String(e.folder.id ?? ""), path: e.folder.path });
          legacy.set(e.folder.path.toLowerCase(), e.timetable);
        }
      }
      // フォルダの名前変更・移動に合わせて、今の場所を引き直す
      const found = await backend.resolve(refs).catch(() => refs.map(() => null));
      let reg = emptyRegistry();
      let save = legacy.size > 0;
      for (let i = 0; i < refs.length; i++) {
        const now = found[i];
        if (!now) {
          save = true;
          continue;
        }
        const ref = { id: now.id, path: now.path };
        if (now.path !== refs[i].path) save = true;
        let tt = await this.readFile(ref);
        const old = legacy.get(refs[i].path.toLowerCase());
        if (!tt && old !== undefined) {
          const r = validateTimetable(old);
          if (r.ok) {
            tt = r.timetable;
            await this.writeFile(ref, tt).catch(() => {});
          }
        }
        if (tt) reg = putTimetable(reg, ref, tt);
      }
      this.reg = reg;
      if (save) await this.saveList().catch(() => {});
    })();
    return this.loading;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get(folder: EntryRef): Timetable | null {
    return findTimetable(this.reg, folder);
  }

  /** すべての時間割（学校のフォルダと、その時間割） */
  all(): TimetableRegistry["entries"] {
    return this.reg.entries;
  }

  /** 検査して、学校のフォルダの中に保存する。結びつけたフォルダのファイルID が空なら、パスから引いて埋める */
  async set(folder: EntryRef, raw: unknown): Promise<Timetable> {
    const r = validateTimetable(raw);
    if (!r.ok) throw new BackendError({ code: "invalid", message: r.errors.join("\n") });
    const tt = r.timetable;
    await fillIds(tt);
    // 先にフォルダの中へ書く（書けなければ、一覧も変えない）
    await this.writeFile(folder, tt);
    this.reg = putTimetable(this.reg, folder, tt);
    await this.saveList();
    this.notify();
    return tt;
  }

  async delete(folder: EntryRef): Promise<void> {
    await backend.folderDataDelete(folder, FILE);
    this.reg = removeTimetable(this.reg, folder);
    await this.saveList();
    this.notify();
  }

  /** フォルダを開いたとき：一覧に無いフォルダに時間割のファイルがあれば、一覧に足す（別の PC で作った時間割） */
  async discover(folder: EntryRef): Promise<void> {
    await this.load();
    if (folder.id === "" || this.get(folder)) return;
    const tt = await this.readFile(folder);
    if (!tt) return;
    this.reg = putTimetable(this.reg, folder, tt);
    await this.saveList();
    this.notify();
  }

  /** フォルダの中のファイルを読み直す（別の PC で書き換えられ、同期で届いたとき。アプリの窓に戻ってきたときに呼ぶ） */
  async refresh(): Promise<void> {
    await this.load();
    let reg = this.reg;
    for (const e of this.reg.entries) {
      const tt = await this.readFile(e.folder);
      // ファイルが消えていたら（別の PC で消した）、一覧からも外す
      if (!tt) reg = removeTimetable(reg, e.folder);
      else if (JSON.stringify(tt) !== JSON.stringify(e.timetable)) reg = putTimetable(reg, e.folder, tt);
    }
    if (reg === this.reg) return;
    this.reg = reg;
    await this.saveList();
    this.notify();
  }

  /** フォルダの中の時間割を読む。無い・壊れていれば null */
  private async readFile(folder: EntryRef): Promise<Timetable | null> {
    const text = await backend.folderDataRead(folder, FILE).catch(() => null);
    if (!text) return null;
    let raw: unknown;
    try {
      raw = fromTimetableFile(JSON.parse(text), folder.path);
    } catch {
      return null;
    }
    const r = validateTimetable(raw);
    if (!r.ok) return null;
    await fillIds(r.timetable);
    return r.timetable;
  }

  private writeFile(folder: EntryRef, tt: Timetable): Promise<void> {
    return backend.folderDataWrite(folder, FILE, JSON.stringify(toTimetableFile(tt, folder.path), null, 2));
  }

  /** この PC のアプリのデータに、時間割のあるフォルダの一覧を書く */
  private saveList(): Promise<void> {
    const list: FolderList = { v: 2, folders: this.reg.entries.map((e) => ({ ...e.folder })) };
    return backend.appDataSave("timetables", JSON.stringify(list));
  }

  private notify() {
    for (const cb of this.listeners) cb();
  }

  private async here(): Promise<Location | null> {
    if (!this.reg.entries.some((e) => e.timetable.place)) return null;
    if (this.location && Date.now() - this.location.at < LOCATION_TTL_MS) return this.location.value;
    let value: Location | null = null;
    try {
      value = await backend.getLocation();
    } catch {
      // Wi-Fi の無い PC など、位置が取れないときは時刻だけで決める（ADR 0010 判断4）
    }
    this.location = { at: Date.now(), value };
    return value;
  }

  /** そのフォルダの時間割での、今の授業 */
  async current(folder: EntryRef, now = new Date()): Promise<CurrentClass> {
    const tt = this.get(folder);
    return tt ? currentClass(tt, now, tt.place ? await this.here() : null) : null;
  }

  /** すべての時間割での、今の授業（アドレスバーの横のボタン用） */
  async allNow(now = new Date()): Promise<NowClass[]> {
    return allCurrent(this.reg, now, await this.here());
  }
}

export const timetableService = new TimetableService();
