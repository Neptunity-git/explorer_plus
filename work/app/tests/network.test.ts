// MOD の通信先（manifest の network。ADR 0026）。Rust の mods.rs の valid_origin と同じ決まり
import { describe, expect, it } from "vitest";
import { checkNetwork, validOrigin } from "../src/core/network";
import { validateManifest } from "../src/core/manifest";

describe("validOrigin", () => {
  it("https の origin だけ", () => {
    for (const ok of ["https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://api.example.com:8443"]) expect(validOrigin(ok)).toBe(true);
    for (const ng of [
      "http://example.com",
      "https://example.com/path",
      "https://Example.com",
      "https://192.168.0.1",
      "https://[::1]",
      "https://localhost",
      "https://printer.local",
      "https://mod.localhost",
      "https://*",
      "https://*.com",
      "https://a.com:0",
      "https://user@a.com",
    ])
      expect(validOrigin(ng)).toBe(false);
  });
});

describe("checkNetwork", () => {
  it("省略は undefined。重なりはまとめ、誤りは理由を返す", () => {
    expect(checkNetwork(undefined, [])).toBeUndefined();
    expect(checkNetwork(["https://a.com", "https://a.com"], [])).toEqual(["https://a.com"]);
    const errors: string[] = [];
    checkNetwork(["http://a.com"], errors);
    expect(errors[0]).toMatch(/https origin/);
    const many: string[] = [];
    checkNetwork(Array.from({ length: 11 }, (_, i) => `https://a${i}.com`), many);
    expect(many[0]).toMatch(/at most 10/);
  });

  it("manifest の一部として確かめる", () => {
    const base = { id: "my.map", name: "地図", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] };
    const r = validateManifest({ ...base, network: ["https://tile.openstreetmap.org"] });
    expect(r.ok && r.manifest.network).toEqual(["https://tile.openstreetmap.org"]);
    expect(validateManifest({ ...base, network: ["http://x.com"] }).ok).toBe(false);
  });
});
