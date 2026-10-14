import { describe, expect, it } from "vitest";
import { parseModMessage } from "../src/core/protocol";

function call(id: number, method: string, params: Record<string, unknown>) {
  return parseModMessage({ ep: 1, kind: "call", id, method, params });
}

describe("tags.list / timetable.get / timetable.current", () => {
  it("tags.list with extra params returns empty params", () => {
    const result = call(1, "tags.list", { a: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({});
      }
    }
  });

  it("timetable.get with empty params returns empty params", () => {
    const result = call(2, "timetable.get", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({});
      }
    }
  });

  it("timetable.current with empty params returns empty params", () => {
    const result = call(3, "timetable.current", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({});
      }
    }
  });
});

describe("tags.create", () => {
  it("valid name and color", () => {
    const result = call(4, "tags.create", { name: "重要", color: "#ff0000", x: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ name: "重要", color: "#ff0000" });
      }
    }
  });

  it("empty name fails", () => {
    const result = call(5, "tags.create", { name: "", color: "#ff0000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("name too long (41 chars) fails", () => {
    const result = call(5, "tags.create", { name: "x".repeat(41), color: "#ff0000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("missing color fails", () => {
    const result = call(5, "tags.create", { name: "a" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("color too long (17 chars) fails", () => {
    const result = call(5, "tags.create", { name: "a", color: "x".repeat(17) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});

describe("tags.update", () => {
  it("id and color only (no name key)", () => {
    const result = call(6, "tags.update", { id: "tag-1", color: "#00ff00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ id: "tag-1", color: "#00ff00" });
        expect(result.message.params).not.toHaveProperty("name");
      }
    }
  });

  it("id, name and color", () => {
    const result = call(7, "tags.update", { id: "tag-1", name: "a", color: "#000000" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ id: "tag-1", name: "a", color: "#000000" });
      }
    }
  });

  it("id only (no name, no color) fails", () => {
    const result = call(5, "tags.update", { id: "tag-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("empty id fails", () => {
    const result = call(5, "tags.update", { id: "", color: "#000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("id too long (65 chars) fails", () => {
    const result = call(5, "tags.update", { id: "x".repeat(65), color: "#000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("empty name fails", () => {
    const result = call(5, "tags.update", { id: "tag-1", name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});

describe("tags.delete", () => {
  it("valid id", () => {
    const result = call(8, "tags.delete", { id: "tag-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ id: "tag-1" });
      }
    }
  });

  it("missing id fails", () => {
    const result = call(5, "tags.delete", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});

describe("tags.assign", () => {
  it("valid items, tagId, on=false", () => {
    const result = call(9, "tags.assign", {
      items: [{ id: "1:a", path: "C:\\a", q: 1 }],
      tagId: "tag-1",
      on: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({
          items: [{ id: "1:a", path: "C:\\a" }],
          tagId: "tag-1",
          on: false,
        });
      }
    }
  });

  it("empty items fails", () => {
    const result = call(5, "tags.assign", { items: [], tagId: "tag-1", on: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("on not boolean fails", () => {
    const result = call(5, "tags.assign", { items: [{ id: "a", path: "p" }], tagId: "tag-1", on: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("missing tagId fails", () => {
    const result = call(5, "tags.assign", { items: [{ id: "a", path: "p" }], on: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});

describe("tags.entries", () => {
  it("valid tagId", () => {
    const result = call(10, "tags.entries", { tagId: "tag-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ tagId: "tag-1" });
      }
    }
  });

  it("tagId not string fails", () => {
    const result = call(5, "tags.entries", { tagId: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});

describe("timetable.set", () => {
  it("valid timetable object", () => {
    const result = call(11, "timetable.set", { timetable: { days: [1] } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ timetable: { days: [1] } });
      }
    }
  });

  it("timetable null is allowed", () => {
    const result = call(12, "timetable.set", { timetable: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.kind).toBe("call");
      if (result.message.kind === "call") {
        expect(result.message.params).toEqual({ timetable: null });
      }
    }
  });

  it("missing timetable fails", () => {
    const result = call(5, "timetable.set", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});
