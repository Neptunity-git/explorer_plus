import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/core/manifest";

function base() {
  return {
    id: "test-mod",
    name: "Test Mod",
    version: "1.0.0",
    apiVersion: 1,
    entry: "index.js",
    uses: ["entries"],
  };
}

describe("manifest location (ADR 0014 判断1)", () => {
  it("no location key -> ok and manifest has no location key", () => {
    const result = validateManifest(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("location" in result.manifest).toBe(false);
  });

  it("location: 'none' -> ok and manifest.location is 'none'", () => {
    const result = validateManifest({ ...base(), location: "none" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.location).toBe("none");
  });

  it("location: 'folder' -> ok and manifest.location is 'folder'", () => {
    const result = validateManifest({ ...base(), location: "folder" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.location).toBe("folder");
  });

  it("location: 'global' -> not ok with exactly one location error", () => {
    const result = validateManifest({ ...base(), location: "global" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const locErrors = result.errors.filter((e) => e.startsWith("location: "));
    expect(locErrors).toHaveLength(1);
  });

  it("location: 1 -> not ok with exactly one location error", () => {
    const result = validateManifest({ ...base(), location: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const locErrors = result.errors.filter((e) => e.startsWith("location: "));
    expect(locErrors).toHaveLength(1);
  });

  it("location: null -> not ok with exactly one location error", () => {
    const result = validateManifest({ ...base(), location: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const locErrors = result.errors.filter((e) => e.startsWith("location: "));
    expect(locErrors).toHaveLength(1);
  });
});
