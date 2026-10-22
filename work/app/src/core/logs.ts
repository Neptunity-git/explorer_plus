// ログ（ADR 0029）。本体のログ（source "app"）と、MOD ごとのログ（source は MOD の id）。
// ここは、1件の形・ファイルの1行との行き来・本体の操作の説明・出しすぎを抑える仕組み（画面や通信を使わない部分）。

import type { LogEntry, LogLevel } from "../api/types";
export type { LogEntry, LogLevel };

export const APP_LOG = "app";
/** 1件の長さの上限（文字） */
export const LOG_TEXT_MAX = 2000;
/** 覚えておく件数（出どころごと） */
export const LOG_KEEP = 1000;

const LEVELS: readonly LogLevel[] = ["info", "warn", "error"];

export function clip(text: string, max = LOG_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…（${text.length - max} 文字省略）` : text;
}

/** ファイルに書く1行（source はファイルで分かるので入れない） */
export function toLine(e: LogEntry): string {
  return JSON.stringify({ t: e.t, level: e.level, text: e.text });
}

/** 重さの順（大きいほど重い） */
export const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 書き出すファイルの時刻（この PC の時刻で、日付つき）：2026-10-22 12:34:56.789 */
export function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * 人が読む・人に渡すための文字のファイルの中身（minLevel 以上の重さだけ）。1件が `時刻 [重さ] 本文`。
 * 本文が何行かあるときは、2行目からを字下げして、件の始まりが見分けられるようにする。
 * 改行は \r\n（メモ帳でもそのまま読める）
 */
export function toText(entries: LogEntry[], minLevel: LogLevel = "info"): string {
  return entries
    .filter((e) => LEVEL_RANK[e.level] >= LEVEL_RANK[minLevel])
    .map((e) => `${formatTime(e.t)} [${e.level}] ${e.text.replace(/\r?\n/g, "\r\n    ")}\r\n`)
    .join("");
}

/** ファイルの1行を読む。壊れた行は null */
export function fromLine(line: string, source: string): LogEntry | null {
  try {
    const v = JSON.parse(line) as Record<string, unknown>;
    if (typeof v.t !== "number" || typeof v.text !== "string" || !LEVELS.includes(v.level as LogLevel)) return null;
    return { t: v.t, level: v.level as LogLevel, source, text: v.text };
  } catch {
    return null;
  }
}

/** 決まった数だけ覚えておく入れ物（古いものから捨てる） */
export class LogRing {
  private items: LogEntry[] = [];
  constructor(private readonly max = LOG_KEEP) {}
  add(e: LogEntry) {
    this.items.push(e);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
  /** ファイルから読んだ古いものを、前に足す */
  prepend(old: LogEntry[]) {
    this.items = [...old, ...this.items].slice(-this.max);
  }
  list(): LogEntry[] {
    return [...this.items];
  }
  clear() {
    this.items = [];
  }
}

/**
 * 出しすぎを抑える：windowMs の間に max 件まで。超えた最初の1件だけ "first-drop"（「省略した」と1回だけ書くため）、そのあとは "drop"
 */
export class LogLimiter {
  private start = 0;
  private count = 0;
  constructor(
    private readonly max = 100,
    private readonly windowMs = 10_000,
  ) {}
  allow(now: number): "ok" | "first-drop" | "drop" {
    if (now - this.start >= this.windowMs) {
      this.start = now;
      this.count = 0;
    }
    this.count++;
    if (this.count <= this.max) return "ok";
    return this.count === this.max + 1 ? "first-drop" : "drop";
  }
}

// ---- 本体の操作の説明（本体のログ） ----

type Ref = { path?: string };
const nameOf = (p: unknown) => (typeof p === "string" ? p.replace(/\\+$/, "").split("\\").pop() || p : "?");
const items = (v: unknown): string => {
  const list = Array.isArray(v) ? (v as (Ref | string)[]) : [];
  const names = list.map((x) => nameOf(typeof x === "string" ? x : x?.path));
  return names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} ほか ${names.length - 3} 個`;
};
const ref = (v: unknown) => (v && typeof v === "object" ? String((v as Ref).path ?? "?") : "?");

/**
 * 本体のログに残す操作（ファイルを変える・開く・MOD を出し入れする）の説明。残さない操作は null。
 * 引数は Rust のコマンドに渡すものそのまま
 */
export function describeCommand(cmd: string, a: Record<string, unknown> = {}): string | null {
  switch (cmd) {
    case "open_entry":
      return `開く：${ref(a.item)}`;
    case "open_with":
      return `プログラムから開く：${ref(a.item)}`;
    case "trash_entries":
      return `ごみ箱へ：${items(a.items)}`;
    case "rename_entry":
      return `名前の変更：${ref(a.item)} → ${String(a.newName)}`;
    case "create_folder":
      return `フォルダを作る：${String(a.parent)}\\${String(a.name)}`;
    case "transfer":
      return `${a.effect === "copy" ? "コピー" : "移動"}：${items(a.items)} → ${String(a.dest)}`;
    case "transfer_paths":
      return `${a.effect === "copy" ? "コピー" : "移動"}（ほかのアプリから）：${items(a.paths)} → ${String(a.dest)}`;
    case "clipboard_paste":
      return `貼り付け → ${String(a.dest)}`;
    case "create_entry":
      return `作る：${ref(a.folder)}\\${String(a.name)}`;
    case "create_shortcut":
      return `ショートカットを作る：${ref(a.target)} → ${ref(a.folder)}`;
    case "archive_create":
      return `圧縮（${String(a.format)}）：${items(a.items)}`;
    case "archive_extract":
      return `展開：${ref(a.item)}`;
    case "drag_out":
      return `ほかのアプリへドラッグ：${items(a.items)}`;
    case "run_command":
      return `コマンドを実行：${String(a.file)} ${String(a.args ?? "")}`.trim();
    case "onedrive_action":
      return `OneDrive（${String(a.action)}）：${ref(a.item)}`;
    case "mod_install":
      return "MOD を入れる";
    case "mod_remove":
      return `MOD を外す：${String(a.id)}`;
    case "dev_mod_add":
      return "開発中の MOD を読み込む";
    case "dev_mod_create":
      return `MOD をひな形から作る：${String(a.name)}`;
    case "mod_pack":
      return `MOD を zip にする：${String(a.id)}`;
    case "secret_set":
      // 値は書かない
      return `秘密の設定を${a.value === null ? "消す" : "預ける"}：${String(a.viewId)} の ${String(a.key)}`;
    case "secret_clear":
      return `秘密の設定をすべて消す：${String(a.viewId)}`;
    default:
      return null;
  }
}

/** 失敗しても本体のログに残さないもの（よくあること・使う側が扱うもの） */
export function quietFailure(cmd: string, code: string): boolean {
  // やめた（確かめの画面で「やめる」など）は失敗ではない
  if (code === "denied") return true;
  // あるか確かめるためのもの
  return ["resolve", "path_kind", "file_ids", "folder_data_read", "app_data_load", "view_storage_load", "log_append", "log_tail"].includes(cmd);
}

// ---- MOD が本体に頼んだこと（MOD ごとのログ） ----

/** URL の、? より前（問い合わせの中身は書かない） */
export function urlForLog(url: unknown): string {
  const s = String(url ?? "");
  const q = s.search(/[?#]/);
  return q >= 0 ? `${s.slice(0, q)}?…` : s;
}

/** MOD ごとのログに残す、本体への頼みごと（成功したとき）。残さないものは null */
export function describeModCall(method: string, p: Record<string, unknown>, result: unknown): string | null {
  switch (method) {
    case "net.fetch": {
      const status = result && typeof result === "object" ? (result as { status?: number }).status : undefined;
      return `通信：${String(p.method ?? "GET")} ${urlForLog(p.url)}${p.secret ? `（秘密の設定 ${String(p.secret)} を付けた）` : ""} → ${status ?? "?"}`;
    }
    case "net.url":
      return `通信の URL を発行：${urlForLog(p.url)}`;
    case "open":
      return `開く：${ref(p)}`;
    case "trash":
      return `ごみ箱へ：${items(p.items)}`;
    case "rename":
      return `名前の変更：${ref(p)} → ${String(p.newName ?? "?")}`;
    case "createFolder":
      return "フォルダを作る";
    case "files.create":
      return `作る：${ref(p.folder)}\\${String(p.name)}`;
    case "files.createShortcut":
      return `ショートカットを作る：${ref(p.target)} → ${ref(p.folder)}`;
    case "clipboard.copy":
    case "clipboard.cut":
      return `${method === "clipboard.cut" ? "切り取り" : "コピー"}：${items(p.items)}`;
    case "clipboard.paste":
      return "貼り付け";
    case "drag.start":
      return `ドラッグ：${items(p.items)}`;
    case "collections.create":
      return `コレクションを作る：${String(p.name)}`;
    case "collections.delete":
      return `コレクションを消す：${String(p.id)}`;
    case "tags.assign":
      return "タグを付ける・外す";
    default:
      return null;
  }
}
