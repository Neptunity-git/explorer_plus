// アプリの中のドラッグ＆ドロップ（ADR 0015 判断2）。
// ビューの中で項目をドラッグし始めると、ビューのランタイムがマウスの動きを本体へ送ってくる
// （iframe の中で押したボタンの動きは、離すまでその iframe に届くため）。本体はその位置で、落とせる場所を探して光らせる。
// 落とせる場所：ビューの中のフォルダ（ビューが知らせる）、アドレスバーの区切り・左の欄（data-drop-path）、タブ（そのタブのフォルダへ）、ビューの空いている所（そのタブのフォルダへ）。
import type { EntryRef, Rect } from "../api/types";
import { dropEffect } from "../core/drop";

/** タブの上でこの時間止まると、そのタブに切り替わる */
const TAB_HOVER_MS = 600;

export type WindowTarget = { ref: EntryRef; rect: Rect };

/** 本体（App）から借りるもの */
export interface DragHost {
  /** タブのボタンと、そのタブのフォルダ（フォルダと関係ないビューなら null）と、ビューの表示場所 */
  tabs(): { id: string; button: HTMLElement; folder: string | null; pane: HTMLElement; active: boolean }[];
  activateTab(id: string): void;
  /** そのタブのビューに「落とせる場所を知らせ直して」と頼む */
  requestTargets(id: string): void;
  /** ドラッグ中に、元のビューを見えなくしても、マウスの動きが届き続けるようにする（display:none にしない） */
  keepAlive(pane: HTMLElement | null): void;
  drop(items: EntryRef[], dest: string, effect: "move" | "copy"): Promise<void>;
}

type Hit = { dest: string; label: string; box: Rect; tabId?: string };

function el(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

const nameOf = (path: string) => path.replace(/\\+$/, "").split("\\").pop() || path;
const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;

export class DragController {
  private items: EntryRef[] = [];
  private sourceTab = "";
  /** タブごとの、ビューの中の落とせる場所（本体の画面の座標） */
  private targets = new Map<string, WindowTarget[]>();
  private ghost: HTMLDivElement | null = null;
  private highlight: HTMLDivElement | null = null;
  private hoverTab: { id: string; since: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastHit: Hit | null = null;
  private lastEffect: "move" | "copy" | null = null;

  constructor(private readonly host: DragHost) {}

  get active(): boolean {
    return this.ghost !== null;
  }

  start(tabId: string, items: EntryRef[], x: number, y: number, targets: WindowTarget[]) {
    this.cancel();
    this.items = items;
    this.sourceTab = tabId;
    this.targets = new Map([[tabId, targets]]);
    this.ghost = el("drag-ghost");
    this.highlight = el("drag-highlight");
    document.body.append(this.highlight, this.ghost);
    document.body.classList.add("dragging");
    this.host.keepAlive(this.host.tabs().find((t) => t.id === tabId)?.pane ?? null);
    this.move(x, y, false, false);
  }

  setTargets(tabId: string, targets: WindowTarget[]) {
    if (this.active) this.targets.set(tabId, targets);
  }

  private hitTest(x: number, y: number): Hit | null {
    // 1. アドレスバーの区切り・左の欄など、本体の落とせる場所
    for (const e of document.querySelectorAll<HTMLElement>("[data-drop-path]")) {
      const r = e.getBoundingClientRect();
      if (r.width && inside(r, x, y)) return { dest: e.dataset.dropPath!, label: nameOf(e.dataset.dropPath!), box: r };
    }
    const tabs = this.host.tabs();
    // 2. タブ：そのタブのフォルダへ（止まっていると切り替わる）
    for (const t of tabs) {
      const r = t.button.getBoundingClientRect();
      if (inside(r, x, y)) return t.folder ? { dest: t.folder, label: nameOf(t.folder), box: r, tabId: t.id } : { dest: "", label: "", box: r, tabId: t.id };
    }
    // 3. 表示中のタブのビューの中：フォルダの上ならそのフォルダ、空いている所ならそのタブのフォルダ
    const shown = tabs.find((t) => t.active);
    if (shown && inside(shown.pane.getBoundingClientRect(), x, y)) {
      const t = (this.targets.get(shown.id) ?? []).find((tg) => inside(tg.rect, x, y));
      if (t) return { dest: t.ref.path, label: nameOf(t.ref.path), box: t.rect };
      if (shown.folder) return { dest: shown.folder, label: nameOf(shown.folder), box: shown.pane.getBoundingClientRect() };
    }
    return null;
  }

  private watchTab(hit: Hit | null) {
    const id = hit?.tabId;
    if (this.hoverTab && this.hoverTab.id === id) return;
    if (this.hoverTab) clearTimeout(this.hoverTab.timer);
    this.hoverTab = null;
    if (!id || this.host.tabs().find((t) => t.id === id)?.active) return;
    this.hoverTab = {
      id,
      since: Date.now(),
      timer: setTimeout(() => {
        // タブの上で止まったら、そのタブに切り替え、そのビューに落とせる場所を知らせてもらう
        this.host.activateTab(id);
        this.host.requestTargets(id);
      }, TAB_HOVER_MS),
    };
  }

  move(x: number, y: number, ctrl: boolean, shift: boolean) {
    if (!this.ghost || !this.highlight) return;
    const hit = this.hitTest(x, y);
    this.watchTab(hit);
    const effect = hit && hit.dest ? dropEffect(this.items.map((i) => i.path), hit.dest, { ctrl, shift }) : null;
    this.lastHit = hit;
    this.lastEffect = effect;
    const n = this.items.length === 1 ? nameOf(this.items[0].path) : `${this.items.length} 個の項目`;
    this.ghost.textContent = effect ? `${n} → ${effect === "move" ? "移動" : "コピー"}：${hit!.label}` : hit?.tabId && !hit.dest ? `${n}（タブの上で止まると切り替わる）` : n;
    this.ghost.classList.toggle("no-drop", !effect);
    Object.assign(this.ghost.style, { left: `${x + 14}px`, top: `${y + 16}px` });
    this.highlight.hidden = !effect;
    if (effect && hit) Object.assign(this.highlight.style, { left: `${hit.box.x}px`, top: `${hit.box.y}px`, width: `${hit.box.width}px`, height: `${hit.box.height}px` });
  }

  async end(x: number, y: number, ctrl: boolean, shift: boolean, cancel: boolean) {
    if (!this.active) return;
    this.move(x, y, ctrl, shift);
    const hit = this.lastHit;
    const effect = this.lastEffect;
    const items = this.items;
    this.cancel();
    if (!cancel && hit && effect) await this.host.drop(items, hit.dest, effect);
  }

  cancel() {
    if (this.hoverTab) clearTimeout(this.hoverTab.timer);
    this.hoverTab = null;
    this.ghost?.remove();
    this.highlight?.remove();
    this.ghost = this.highlight = null;
    this.lastHit = null;
    this.lastEffect = null;
    document.body.classList.remove("dragging");
    this.host.keepAlive(null);
  }

  /** 元のタブ（ドラッグを始めたビュー） */
  get source(): string {
    return this.sourceTab;
  }
}
