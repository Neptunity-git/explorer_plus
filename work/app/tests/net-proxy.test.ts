// 本体が代わりに通信する（net.fetch・net.url）と、秘密の設定（type "secret"）の検査（ADR 0027）
import { describe, expect, it } from "vitest";
import { METHOD_REQUIRES } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";
import { parseNetFrame } from "../src/core/network";
import { checkSettings, normalizeSettings, validSecretValue } from "../src/core/settings";
import { validateManifest } from "../src/core/manifest";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 3, method, params });
const params = (method: string, p: Record<string, unknown>) => {
  const r = call(method, p);
  return r.ok && r.message.kind === "call" ? r.message.params : null;
};

describe("net.fetch・net.url のメッセージ", () => {
  it("uses は要らない（宛先は本体の Rust が network で確かめる）", () => {
    expect(METHOD_REQUIRES["net.fetch"]).toBeNull();
    expect(METHOD_REQUIRES["net.url"]).toBeNull();
  });

  it("method の既定は GET。小文字も受ける", () => {
    expect(params("net.fetch", { url: "https://api.example.com/a" })).toEqual({ url: "https://api.example.com/a", method: "GET", headers: [] });
    const body = new Uint8Array([1, 2]);
    expect(params("net.fetch", { url: "https://a.com/", method: "post", headers: [["X-A", "1"]], body, secret: "apiKey" })).toEqual({
      url: "https://a.com/",
      method: "POST",
      headers: [["X-A", "1"]],
      body,
      secret: "apiKey",
    });
  });

  it("おかしな形は断る", () => {
    for (const p of [
      { url: "" },
      { url: "https://a.com/", method: "CONNECT" },
      { url: "https://a.com/", headers: { "X-A": "1" } },
      { url: "https://a.com/", headers: [["X-A"]] },
      { url: "https://a.com/", body: "x" },
      { url: "https://a.com/", method: "POST", body: 12 },
      { url: "https://a.com/", secret: "../x" },
      { url: "https://a.com/", headers: Array.from({ length: 31 }, () => ["X", "1"]) },
    ])
      expect(call("net.fetch", p).ok, JSON.stringify(p)).toBe(false);
    expect(params("net.url", { url: "https://a.com/t.png", secret: "k" })).toEqual({ url: "https://a.com/t.png", secret: "k" });
    expect(call("net.url", { url: 1 }).ok).toBe(false);
  });
});

describe("結果のバイト列", () => {
  it("[長さ][説明][中身] を分ける", () => {
    const meta = new TextEncoder().encode(JSON.stringify({ status: 404, statusText: "Not Found", url: "https://a.com/", headers: [["content-type", "text/plain"]] }));
    const buf = new Uint8Array(4 + meta.length + 2);
    new DataView(buf.buffer).setUint32(0, meta.length, true);
    buf.set(meta, 4);
    buf.set([7, 8], 4 + meta.length);
    const r = parseNetFrame(buf.buffer);
    expect(r.status).toBe(404);
    expect(r.headers).toEqual([["content-type", "text/plain"]]);
    expect([...r.body]).toEqual([7, 8]);
  });
});

describe("秘密の設定（type secret）", () => {
  const net = ["https://api.example.com", "https://*.tiles.example.org"];
  const secret = (send: unknown) => ({ key: "apiKey", label: "API キー", type: "secret", send });

  it("ヘッダか ?query= のどちらかで、宛先は network にある * の無いもの", () => {
    const errors: string[] = [];
    const defs = checkSettings(
      [secret({ origin: "https://api.example.com", header: "Authorization", prefix: "Bearer " }), { ...secret({ origin: "https://api.example.com", query: "appid" }), key: "q" }],
      errors,
      net,
    );
    expect(errors).toEqual([]);
    expect(defs?.map((d) => d.type === "secret" && d.send)).toEqual([
      { origin: "https://api.example.com", header: "Authorization", prefix: "Bearer " },
      { origin: "https://api.example.com", query: "appid" },
    ]);
  });

  it("おかしな送り先・付け方は断る", () => {
    for (const send of [
      { origin: "https://evil.example.net", header: "X-Key" },
      { origin: "https://*.tiles.example.org", query: "k" },
      { origin: "https://api.example.com" },
      { origin: "https://api.example.com", header: "X-Key", query: "k" },
      { origin: "https://api.example.com", header: "Cookie" },
      { origin: "https://api.example.com", header: "X Key" },
      { origin: "https://api.example.com", header: "X-Key", prefix: "a\nb" },
      { origin: "https://api.example.com", query: "a&b" },
    ]) {
      const errors: string[] = [];
      checkSettings([secret(send)], errors, net);
      expect(errors.length, JSON.stringify(send)).toBe(1);
    }
  });

  it("値は覚えず、MOD には「預けてあるか」だけ", () => {
    const defs = checkSettings([secret({ origin: "https://api.example.com", query: "k" })], [], net)!;
    expect(normalizeSettings(defs, { apiKey: "漏れてはいけない値" })).toEqual({ apiKey: false });
  });

  it("預けられる値の形", () => {
    expect(validSecretValue("  sk-abc_123/+=  ")).toBe(true);
    expect(validSecretValue("")).toBe(false);
    expect(validSecretValue("キー")).toBe(false);
    expect(validSecretValue("a\tb")).toBe(false);
    expect(validSecretValue("x".repeat(2001))).toBe(false);
  });

  it("manifest では network を先に読んでから確かめる", () => {
    const base = { id: "my.weather", name: "天気", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] };
    const settings = [secret({ origin: "https://api.example.com", query: "appid" })];
    expect(validateManifest({ ...base, network: ["https://api.example.com"], settings }).ok).toBe(true);
    expect(validateManifest({ ...base, settings }).ok).toBe(false);
  });
});
