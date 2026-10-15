// ホームの欄の配置（ADR 0031）。VS Code のように、欄を分けた入れ物（split）と欄（文字列の id）の木で表す。
//   split: { dir: "row"（左右に並べる）| "col"（上下に並べる）, sizes: [割合…]（合計 1）, children: [split か id …]（2つ以上） }
// ここは画面を使わない計算だけ（ホームの index.js が使う。試験は tests/home-layout.test.ts）。

export const PANELS = ["recent", "mods", "logs"];

export const DEFAULT_LAYOUT = {
  dir: "col",
  sizes: [0.45, 0.55],
  children: [{ dir: "row", sizes: [0.42, 0.58], children: ["recent", "mods"] }, "logs"],
};

const clone = (n) => JSON.parse(JSON.stringify(n));
const isSplit = (n) => n !== null && typeof n === "object";

/** 木の中の欄の id（出てくる順） */
export function panelsOf(node) {
  return isSplit(node) ? node.children.flatMap(panelsOf) : [node];
}

/** 覚えていた配置が、今の欄の決まりに合うか（壊れていたら、既定の配置に戻すため） */
export function validLayout(node) {
  const ok = (n) => {
    if (typeof n === "string") return PANELS.includes(n);
    if (!isSplit(n) || (n.dir !== "row" && n.dir !== "col")) return false;
    if (!Array.isArray(n.children) || n.children.length < 2 || !Array.isArray(n.sizes) || n.sizes.length !== n.children.length) return false;
    if (!n.sizes.every((s) => typeof s === "number" && s > 0 && Number.isFinite(s))) return false;
    return n.children.every(ok);
  };
  if (!ok(node)) return false;
  const ids = panelsOf(node);
  return ids.length === PANELS.length && PANELS.every((p) => ids.includes(p));
}

/** 割合の合計を 1 にする */
function normalize(sizes) {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => s / sum);
}

/** 欄を取り除く（子が1つになった入れ物は、その子に置き換える） */
export function removePanel(tree, id) {
  const walk = (n) => {
    if (!isSplit(n)) return n === id ? null : n;
    const kept = [];
    const sizes = [];
    n.children.forEach((c, i) => {
      const r = walk(c);
      if (r !== null) {
        kept.push(r);
        sizes.push(n.sizes[i]);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    return { dir: n.dir, sizes: normalize(sizes), children: kept };
  };
  return walk(clone(tree));
}

/** 同じ向きの入れ物の中の、ある子を、2つに分けた割合で置き換える */
function insertNextTo(tree, targetId, id, zone) {
  const dir = zone === "left" || zone === "right" ? "row" : "col";
  const before = zone === "left" || zone === "top";
  const walk = (n) => {
    if (!isSplit(n)) {
      if (n !== targetId) return n;
      return { dir, sizes: [0.5, 0.5], children: before ? [id, n] : [n, id] };
    }
    const i = n.children.indexOf(targetId);
    // 目当ての欄が、同じ向きの入れ物のすぐ下にあれば、入れ子にせず、隣に並べる
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i] / 2;
      const children = [...n.children];
      const sizes = [...n.sizes];
      children.splice(before ? i : i + 1, 0, id);
      sizes.splice(i, 1, half, half);
      return { dir: n.dir, sizes, children };
    }
    return { dir: n.dir, sizes: [...n.sizes], children: n.children.map(walk) };
  };
  return walk(tree);
}

/** 2つの欄の場所を入れ替える */
function swap(tree, a, b) {
  const walk = (n) => (isSplit(n) ? { dir: n.dir, sizes: [...n.sizes], children: n.children.map(walk) } : n === a ? b : n === b ? a : n);
  return walk(tree);
}

/**
 * 欄 id を、欄 targetId の zone へ動かす。zone：left・right・top・bottom（その端に並べる）・center（入れ替える）。
 * 動かせないとき（同じ欄・知らない欄）は、元の木をそのまま返す
 */
export function movePanel(tree, id, targetId, zone) {
  if (id === targetId || !PANELS.includes(id) || !PANELS.includes(targetId)) return tree;
  if (zone === "center") return swap(clone(tree), id, targetId);
  if (!["left", "right", "top", "bottom"].includes(zone)) return tree;
  const without = removePanel(tree, id);
  return without === null ? tree : insertNextTo(without, targetId, id, zone);
}

/** 欄の中の位置（0〜1）から、落とす場所を決める：端の 25% なら、その端。真ん中なら入れ替え */
export function zoneAt(fx, fy) {
  const edges = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ].filter(([, d]) => d < 0.25);
  if (edges.length === 0) return "center";
  edges.sort((a, b) => a[1] - b[1]);
  return edges[0][0];
}

/** 境目を動かした：i 番目と i+1 番目の割合を、delta（割合）だけやりとりする。どちらも min より小さくしない */
export function resizePair(sizes, i, delta, min = 0.08) {
  const out = [...sizes];
  const total = out[i] + out[i + 1];
  const a = Math.min(Math.max(out[i] + delta, min), total - min);
  out[i] = a;
  out[i + 1] = total - a;
  return out;
}
