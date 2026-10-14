import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/core/manifest";

const base = {
  id: "neo.voxel-chest",
  name: "ボクセルチェスト",
  version: "1.0.0",
  apiVersion: 1,
  entry: "index.js",
  uses: ["entries", "size", "entries"],
  extra: 5,
};

describe("validateManifest", () => {
  it("accepts a valid manifest and drops unknown keys", () => {
    const r = validateManifest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest).toEqual({
      id: "neo.voxel-chest",
      name: "ボクセルチェスト",
      version: "1.0.0",
      apiVersion: 1,
      entry: "index.js",
      uses: ["entries", "size"],
    });
    expect("extra" in r.manifest).toBe(false);
    expect("description" in r.manifest).toBe(false);
  });

  it("keeps description when present", () => {
    const r = validateManifest({ ...base, description: "説明" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.description).toBe("説明");
  });

  it("rejects non-object inputs", () => {
    expect(validateManifest(null)).toEqual({ ok: false, errors: ["manifest: must be an object"] });
    expect(validateManifest([])).toEqual({ ok: false, errors: ["manifest: must be an object"] });
    expect(validateManifest("x")).toEqual({ ok: false, errors: ["manifest: must be an object"] });
    expect(validateManifest(5)).toEqual({ ok: false, errors: ["manifest: must be an object"] });
  });

  it("reports one error per missing required field on empty object", () => {
    const r = validateManifest({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const prefixes = ["id: ", "name: ", "version: ", "apiVersion: ", "entry: ", "uses: "];
    for (const p of prefixes) {
      expect(r.errors.filter((e) => e.startsWith(p))).toHaveLength(1);
    }
    expect(r.errors.some((e) => e.startsWith("description: "))).toBe(false);
  });

  it("rejects bad ids", () => {
    for (const id of ["ab", "Neo.view", "neo.view.", "-neo"]) {
      const r = validateManifest({ ...base, id });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors.some((e) => e.startsWith("id: "))).toBe(true);
    }
  });

  it("rejects builtin ids unless allowBuiltin", () => {
    const no = validateManifest({ ...base, id: "builtin.win11" });
    expect(no.ok).toBe(false);
    if (!no.ok) {
      expect(no.errors.some((e) => e.startsWith("id: "))).toBe(true);
    }
    const yes = validateManifest({ ...base, id: "builtin.win11" }, { allowBuiltin: true });
    expect(yes.ok).toBe(true);
  });

  it("validates name length and emptiness", () => {
    const blank = validateManifest({ ...base, name: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.some((e) => e.startsWith("name: "))).toBe(true);

    const ok40 = validateManifest({ ...base, name: "あ".repeat(40) });
    expect(ok40.ok).toBe(true);

    const bad41 = validateManifest({ ...base, name: "あ".repeat(41) });
    expect(bad41.ok).toBe(false);
    if (!bad41.ok) expect(bad41.errors.some((e) => e.startsWith("name: "))).toBe(true);
  });

  it("rejects bad version", () => {
    const r = validateManifest({ ...base, version: "1.0" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("version: "))).toBe(true);
  });

  it("rejects bad apiVersion", () => {
    for (const apiVersion of [2, 1.5, "1"] as unknown[]) {
      const r = validateManifest({ ...base, apiVersion });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors.some((e) => e.startsWith("apiVersion: "))).toBe(true);
    }
  });

  it("rejects bad entry paths", () => {
    for (const entry of [
      "index.ts",
      "/index.js",
      "\\index.js",
      "C:index.js",
      "../index.js",
      "lib\\..\\index.js",
    ]) {
      const r = validateManifest({ ...base, entry });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors.some((e) => e.startsWith("entry: "))).toBe(true);
    }
    const ok = validateManifest({ ...base, entry: "dist/main.js" });
    expect(ok.ok).toBe(true);
  });

  it("reports unknown uses names and dedupes", () => {
    const r = validateManifest({ ...base, uses: ["entries", "foo", "bar"] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain('uses: unknown name "foo"');
    expect(r.errors).toContain('uses: unknown name "bar"');
  });

  it("rejects non-array uses", () => {
    const r = validateManifest({ ...base, uses: "entries" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("uses: "))).toBe(true);
  });

  it("rejects non-string description", () => {
    const r = validateManifest({ ...base, description: 123 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("description: "))).toBe(true);
  });
});
