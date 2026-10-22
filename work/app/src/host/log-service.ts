// ログ（ADR 0029）。本体のログ（"app"）と MOD ごとのログを、画面に出すために覚えておき、Rust に頼んでファイルにも残す。
// ファイルへは少しまとめて書く。初めて見るときに、ファイルに残っている分を読み込む（アプリを起動し直しても見られる）。
import { invoke } from "@tauri-apps/api/core";
import { APP_LOG, LogLimiter, LogRing, clip, fromLine, toLine, toText, type LogEntry, type LogLevel } from "../core/logs";
import { broadcast } from "./sync";

const FLUSH_MS = 1000;

class LogService {
  private readonly rings = new Map<string, LogRing>();
  private readonly loaded = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, LogEntry[]>();
  private readonly limiters = new Map<string, LogLimiter>();
  private readonly listeners = new Set<(e: LogEntry) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private ring(source: string): LogRing {
    let r = this.rings.get(source);
    if (!r) this.rings.set(source, (r = new LogRing()));
    return r;
  }

  add(source: string, level: LogLevel, text: string) {
    const e: LogEntry = { t: Date.now(), level, source, text: clip(text) };
    this.ring(source).add(e);
    const list = this.pending.get(source) ?? [];
    list.push(e);
    this.pending.set(source, list);
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
    for (const cb of this.listeners) cb(e);
    broadcast({ kind: "log", entry: e });
  }

  /** ほかのウィンドウで増えたログ（ファイルへは、そのウィンドウが書く。ADR 0030） */
  addRemote(e: LogEntry) {
    this.ring(e.source).add(e);
    for (const cb of this.listeners) cb(e);
  }

  /** 本体のログ */
  app(level: LogLevel, text: string) {
    this.add(APP_LOG, level, text);
  }

  /** MOD のログ。MOD が出しすぎるときは、少し省く（10 秒に 100 件まで） */
  mod(viewId: string, level: LogLevel, text: string) {
    let lim = this.limiters.get(viewId);
    if (!lim) this.limiters.set(viewId, (lim = new LogLimiter()));
    const ok = lim.allow(Date.now());
    if (ok === "ok") this.add(viewId, level, text);
    else if (ok === "first-drop") this.add(viewId, "warn", "ログが多すぎるので、しばらく省きます（10 秒に 100 件まで）");
  }

  async flush() {
    this.timer = null;
    const all = [...this.pending];
    this.pending.clear();
    for (const [source, list] of all) {
      await invoke("log_append", { source, lines: list.map(toLine) }).catch(() => {});
    }
  }

  /** その出どころのログ（古い順）。初めてなら、ファイルに残っている分も読む */
  async list(source: string): Promise<LogEntry[]> {
    let p = this.loaded.get(source);
    if (!p) {
      p = (async () => {
        await this.flush();
        const lines = await invoke<string[]>("log_tail", { source, max: 1000 }).catch(() => [] as string[]);
        const fromFile = lines.map((l) => fromLine(l, source)).filter((e): e is LogEntry => e !== null);
        // ファイルを読んでいるあいだに増えた分は、まだファイルに無いので残す
        const waiting = this.pending.get(source) ?? [];
        const ring = this.ring(source);
        ring.clear();
        ring.prepend([...fromFile, ...waiting]);
      })();
      this.loaded.set(source, p);
    }
    await p;
    return this.ring(source).list();
  }

  /** ログがある MOD の id（ファイルに残っているもの・このあいだに書いたもの） */
  async sources(): Promise<string[]> {
    const fromFile = await invoke<string[]>("log_sources").catch(() => [] as string[]);
    return [...new Set([...fromFile, ...this.rings.keys()])].filter((s) => s !== APP_LOG).sort();
  }

  /** ログのフォルダのパス（無ければ作る） */
  dir(): Promise<string> {
    return invoke<string>("log_dir");
  }

  /** その出どころのログを、人が読む文字のファイルに書き出して、そのパスを返す（ADR 0038） */
  async exportText(source: string, level: LogLevel = "info"): Promise<string> {
    // 覚えている分（ファイルから読んだ分と、書き込み待ちの分）
    const entries = await this.list(source);
    return invoke<string>("log_export", { source, text: toText(entries, level) });
  }

  async clear(source: string) {
    this.pending.delete(source);
    this.ring(source).clear();
    await invoke("log_clear", { source });
  }

  onEntry(cb: (e: LogEntry) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const logService = new LogService();
