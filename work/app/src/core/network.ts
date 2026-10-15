// MOD の通信先（manifest の network。ADR 0026）。https の origin だけ（"https://example.com"・"https://*.example.com"・ポート付き）。
// パス・IP アドレス・localhost などの PC や家の中の名前は不可。Rust（mods.rs の valid_origin）でも同じ検査をして CSP を作る。

export const NETWORK_MAX = 10;
const LOCAL_TLDS = ["localhost", "local", "internal", "lan", "home", "test", "invalid"];

export function validOrigin(s: string): boolean {
  if (!s.startsWith("https://") || s.length > 200) return false;
  const rest = s.slice("https://".length);
  if (rest === "" || /[/?#@[\] \\A-Z]/.test(rest) || /\s/.test(rest)) return false;
  const colon = rest.lastIndexOf(":");
  const host = colon >= 0 ? rest.slice(0, colon) : rest;
  if (colon >= 0) {
    const p = rest.slice(colon + 1);
    if (!/^\d{1,5}$/.test(p) || Number(p) < 1 || Number(p) > 65535) return false;
  }
  const labels = (host.startsWith("*.") ? host.slice(2) : host).split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9-]+$/.test(l) && !l.startsWith("-") && !l.endsWith("-"))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]+$/.test(tld) && !LOCAL_TLDS.includes(tld);
}

/** manifest の network を確かめる。誤りは errors に足す */
export function checkNetwork(raw: unknown, errors: string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > NETWORK_MAX) {
    errors.push(`network: an array of at most ${NETWORK_MAX} https origins`);
    return undefined;
  }
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== "string" || !validOrigin(o)) {
      errors.push(`network: "${String(o)}" is not an https origin like "https://example.com" (no path, IP address or local name)`);
      continue;
    }
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** net.fetch の結果のバイト列（[説明の長さ 4 バイト][説明の JSON][中身]。Rust の netproxy.rs の frame）を分ける */
export function parseNetFrame(buf: ArrayBuffer): { status: number; statusText: string; url: string; headers: [string, string][]; body: Uint8Array } {
  const view = new DataView(buf);
  const n = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as { status: number; statusText: string; url: string; headers: [string, string][] };
  return { ...meta, body: new Uint8Array(buf.slice(4 + n)) };
}
