import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/core/manifest";

function entryOnly(entry: unknown) {
  return validateManifest({
    id: "test-mod",
    name: "Test",
    version: "1.0.0",
    apiVersion: 1,
    entry,
    uses: [],
  });
}

describe("checkEntry (manifest-entry)", () => {
  it("rejects non-string entry", () => {
    const r = entryOnly(123);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry not ending with .js", () => {
    const r = entryOnly("index.ts");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry starting with /", () => {
    const r = entryOnly("/index.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry containing backslash anywhere", () => {
    const r = entryOnly("a\\b.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry starting with backslash", () => {
    const r = entryOnly("\\index.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry containing colon", () => {
    const r = entryOnly("C:/index.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry with empty path segment (double slash)", () => {
    const r = entryOnly("a//b.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry with . segment", () => {
    const r = entryOnly("./index.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("rejects entry with .. segment", () => {
    const r = entryOnly("../index.js");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^entry: /);
    }
  });

  it("accepts index.js", () => {
    const r = entryOnly("index.js");
    expect(r.ok).toBe(true);
  });

  it("accepts dist/main.js", () => {
    const r = entryOnly("dist/main.js");
    expect(r.ok).toBe(true);
  });

  it("accepts a/b/c.js", () => {
    const r = entryOnly("a/b/c.js");
    expect(r.ok).toBe(true);
  });

  it("accepts my.view.js", () => {
    const r = entryOnly("my.view.js");
    expect(r.ok).toBe(true);
  });

  it("accepts ..js (segment is ..js, not ..)", () => {
    const r = entryOnly("..js");
    expect(r.ok).toBe(true);
  });
});
