import { describe, it, expect } from "vitest";
import {
  emptyTagStore,
  normalizeColor,
  sameRef,
  createTag,
  updateTag,
  deleteTag,
  assignTag,
  tagsOf,
  refsWithTag,
  type TagStore,
} from "../src/core/tags";
import type { EntryRef } from "../src/api/types";

const a: EntryRef = { id: "1:a", path: "C:\\a.txt" };
const b: EntryRef = { id: "1:b", path: "C:\\b.txt" };

function twoTagStore(): TagStore {
  return {
    tags: [
      { id: "tag-1", name: "重要", color: "#ff0000" },
      { id: "tag-2", name: "レポート", color: "#00ff00" },
    ],
    links: [],
  };
}

describe("normalizeColor", () => {
  it("lowercases valid hex", () => {
    expect(normalizeColor("#FF8800")).toBe("#ff8800");
    expect(normalizeColor("#abcdef")).toBe("#abcdef");
  });
  it("rejects invalid", () => {
    expect(normalizeColor("FF8800")).toBeNull();
    expect(normalizeColor("#ff880")).toBeNull();
    expect(normalizeColor("#gg0000")).toBeNull();
    expect(normalizeColor(123)).toBeNull();
  });
});

describe("sameRef", () => {
  it("compares by id when both present", () => {
    expect(sameRef({ id: "a", path: "C:\\x" }, { id: "a", path: "D:\\y" })).toBe(true);
    expect(sameRef({ id: "a", path: "C:\\x" }, { id: "b", path: "C:\\x" })).toBe(false);
  });
  it("compares by path (case-insensitive) when id empty", () => {
    expect(sameRef({ id: "", path: "C:\\X" }, { id: "", path: "c:\\x" })).toBe(true);
    expect(sameRef({ id: "", path: "C:\\X" }, { id: "", path: "C:\\Y" })).toBe(false);
  });
});

describe("emptyTagStore", () => {
  it("returns fresh object each call", () => {
    const s1 = emptyTagStore();
    const s2 = emptyTagStore();
    expect(s1).toEqual({ tags: [], links: [] });
    expect(s1).not.toBe(s2);
  });
});

describe("createTag", () => {
  it("creates a tag and does not mutate input", () => {
    const store = emptyTagStore();
    const before = JSON.parse(JSON.stringify(store));
    const r = createTag(store, "  重要  ", "#FF0000", "tag-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tag).toEqual({ id: "tag-1", name: "重要", color: "#ff0000" });
    expect(r.store.tags).toEqual([r.tag]);
    expect(store).toEqual(before);
  });
  it("invalid name", () => {
    const s = emptyTagStore();
    expect(createTag(s, "", "#ff0000", "t").ok).toBe(false);
    expect(createTag(s, "   ", "#ff0000", "t").ok).toBe(false);
    expect(createTag(s, "x".repeat(41), "#ff0000", "t").ok).toBe(false);
  });
  it("invalid color", () => {
    const s = emptyTagStore();
    const r = createTag(s, "x", "red", "t");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid");
  });
  it("exists by name (case-insensitive)", () => {
    const s = twoTagStore();
    expect(createTag(s, "重要", "#000000", "tag-9").ok).toBe(false);
    expect(createTag(s, " report ", "#000000", "tag-9").ok).toBe(false);
  });
  it("invalid on duplicate id", () => {
    const s = twoTagStore();
    const r = createTag(s, "new", "#000000", "tag-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid");
  });
  it("too-large at 200 tags", () => {
    const tags = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, name: `n${i}`, color: "#000000" }));
    const s: TagStore = { tags, links: [] };
    const r = createTag(s, "new", "#000000", "tnew");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too-large");
  });
});

describe("updateTag", () => {
  it("updates color only", () => {
    const s = twoTagStore();
    const r = updateTag(s, "tag-1", { color: "#0000FF" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tag).toEqual({ id: "tag-1", name: "重要", color: "#0000ff" });
    expect(r.store.tags.map((t) => t.id)).toEqual(["tag-1", "tag-2"]);
  });
  it("updates name only", () => {
    const s = twoTagStore();
    const r = updateTag(s, "tag-1", { name: "最重要" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tag).toEqual({ id: "tag-1", name: "最重要", color: "#ff0000" });
  });
  it("same name as self is ok", () => {
    const s = twoTagStore();
    expect(updateTag(s, "tag-1", { name: "重要" }).ok).toBe(true);
  });
  it("exists on other tag name", () => {
    const s = twoTagStore();
    const r = updateTag(s, "tag-1", { name: "レポート" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("exists");
  });
  it("not-found", () => {
    const s = twoTagStore();
    const r = updateTag(s, "tag-9", { name: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not-found");
  });
  it("invalid color", () => {
    const s = twoTagStore();
    const r = updateTag(s, "tag-1", { color: "blue" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid");
  });
});

describe("assignTag / tagsOf / refsWithTag / deleteTag", () => {
  it("full flow", () => {
    let store = twoTagStore();

    let r = assignTag(store, [a, b], "tag-2", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;

    r = assignTag(store, [a], "tag-1", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;

    expect(tagsOf(store, a)).toEqual(["tag-1", "tag-2"]);
    expect(tagsOf(store, b)).toEqual(["tag-2"]);

    expect(refsWithTag(store, "tag-2")).toEqual([a, b]);
    expect(refsWithTag(store, "tag-1")).toEqual([a]);

    const moved: EntryRef = { id: "1:a", path: "C:\\moved\\a.txt" };
    r = assignTag(store, [moved], "tag-1", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;
    expect(refsWithTag(store, "tag-1")).toEqual([moved]);
    expect(store.links.length).toBe(2);

    r = assignTag(store, [b], "tag-2", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;
    expect(tagsOf(store, b)).toEqual([]);
    expect(store.links.length).toBe(1);

    r = deleteTag(store, "tag-2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;
    expect(store.tags.map((t) => t.id)).toEqual(["tag-1"]);
    expect(tagsOf(store, a)).toEqual(["tag-1"]);

    r = deleteTag(store, "tag-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    store = r.store;
    expect(store.links).toEqual([]);
  });

  it("not-found for assign and delete", () => {
    const s = twoTagStore();
    const r1 = assignTag(s, [a], "tag-9", true);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("not-found");
    const r2 = deleteTag(s, "tag-9");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("not-found");
  });

  it("tagsOf on empty store", () => {
    expect(tagsOf(emptyTagStore(), a)).toEqual([]);
  });
});
