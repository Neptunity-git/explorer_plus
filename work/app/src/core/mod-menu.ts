// MOD が、ほかのビューの右クリックのメニューにも出す項目（ADR 0036）。
// ここは、manifest の menu の検査と、「今の右クリックで、どの項目を出すか」の判定。
import { MENU_LABEL_MAX, MENU_MAX_EXTRA, type ModMenuItem, type ModMenuTarget } from "../api/types";
import { extOf } from "./entries";

export const MOD_MENU_MAX = MENU_MAX_EXTRA;
const TARGETS: readonly ModMenuTarget[] = ["file", "folder", "background"];
const EXT_RE = /^[a-z0-9]{1,16}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 重なりを除いた、宣言どおりの順の文字の並び。ok で1つずつ確かめる。空・形の誤りなら undefined */
function stringList(raw: unknown, ok: (s: string) => boolean): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !ok(v)) return undefined;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** manifest の menu を確かめる。誤りは errors に足す */
export function checkMenu(raw: unknown, errors: string[]): ModMenuItem[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push("menu: must be an array");
    return undefined;
  }
  if (raw.length > MOD_MENU_MAX) {
    errors.push(`menu: at most ${MOD_MENU_MAX} items`);
    return undefined;
  }
  const out: ModMenuItem[] = [];
  const ids = new Set<string>();
  raw.forEach((it, i) => {
    const at = `menu[${i}]`;
    if (!isObj(it)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const before = errors.length;
    if (typeof it.id !== "string" || it.id === "" || it.id.length > 64) errors.push(`${at}.id: must be a string of 1-64 characters`);
    else if (ids.has(it.id)) errors.push(`${at}.id: "${it.id}" is used twice`);
    if (typeof it.label !== "string" || it.label.trim() === "" || it.label.length > MENU_LABEL_MAX) errors.push(`${at}.label: must be a string of 1-${MENU_LABEL_MAX} characters`);
    const targets = it.for === undefined ? undefined : stringList(it.for, (s) => (TARGETS as readonly string[]).includes(s));
    if (it.for !== undefined && !targets) errors.push(`${at}.for: must be a non-empty array of "file", "folder", "background"`);
    const ext = it.ext === undefined ? undefined : stringList(it.ext, (s) => EXT_RE.test(s));
    if (it.ext !== undefined && !ext) errors.push(`${at}.ext: must be a non-empty array of lowercase extensions without "." (a-z, 0-9, up to 16)`);
    else if (ext && targets && !targets.includes("file")) errors.push(`${at}.ext: needs "file" in for`);
    if (it.multiple !== undefined && typeof it.multiple !== "boolean") errors.push(`${at}.multiple: must be true or false`);
    if (it.run !== undefined && it.run !== "open" && it.run !== "background") errors.push(`${at}.run: must be "open" or "background"`);
    if (errors.length > before) return;
    const id = it.id as string;
    ids.add(id);
    out.push({
      id,
      label: it.label as string,
      ...(targets ? { for: targets as ModMenuTarget[] } : {}),
      ...(ext ? { ext } : {}),
      ...(it.multiple !== undefined ? { multiple: it.multiple as boolean } : {}),
      ...(it.run !== undefined ? { run: it.run as "open" | "background" } : {}),
    });
  });
  return out;
}

/** 右クリックした所：空いている所か、選んでいるもの（フォルダか、ファイルの名前） */
export type MenuSelection = { kind: "background" } | { kind: "items"; items: { isDir: boolean; name: string }[] };

/** 今の右クリックで出す項目（menu の順のまま） */
export function matchMenuItems(menu: readonly ModMenuItem[], sel: MenuSelection): ModMenuItem[] {
  return menu.filter((m) => {
    const targets = m.for ?? TARGETS;
    if (sel.kind === "background") return targets.includes("background");
    if (sel.items.length === 0) return false;
    if (m.multiple === false && sel.items.length > 1) return false;
    return sel.items.every((it) =>
      it.isDir ? targets.includes("folder") : targets.includes("file") && (m.ext === undefined || m.ext.includes(extOf(it.name))),
    );
  });
}
