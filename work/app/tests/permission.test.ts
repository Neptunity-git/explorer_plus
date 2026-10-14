import { describe, it, expect } from "vitest";
import { checkPermission, checkStorageValue } from "../src/core/permission";
import { STORAGE_VALUE_MAX_BYTES } from "../src/api/types";

describe("checkPermission", () => {
  it("returns null for methods that require no use", () => {
    expect(checkPermission([], "ready")).toBeNull();
    expect(checkPermission([], "storage.set")).toBeNull();
    expect(checkPermission([], "trash")).toBeNull();
  });

  it("returns not-declared when the required use is missing", () => {
    expect(checkPermission([], "getTree")?.code).toBe("not-declared");
    expect(checkPermission(["entries"], "getTree")?.code).toBe("not-declared");
  });

  it("returns null when the required use is declared", () => {
    expect(checkPermission(["tree"], "getTree")).toBeNull();
  });

  it("returns not-declared for resolve without links", () => {
    expect(checkPermission(["entries", "size"], "resolve")?.code).toBe("not-declared");
  });

  it("returns null for resolve with links", () => {
    expect(checkPermission(["links"], "resolve")).toBeNull();
  });

  it("includes the required use name in the message", () => {
    const error = checkPermission([], "getTree");
    expect(error).not.toBeNull();
    expect(error?.message).toContain("tree");
  });
});

describe("checkStorageValue", () => {
  it("accepts ordinary JSON-serializable values", () => {
    expect(checkStorageValue({ a: [1, 2, "x"] })).toBeNull();
    expect(checkStorageValue(null)).toBeNull();
    expect(checkStorageValue(0)).toBeNull();
    expect(checkStorageValue("")).toBeNull();
  });

  it("rejects values that are not JSON-serializable", () => {
    expect(checkStorageValue(undefined)?.code).toBe("invalid");
    expect(checkStorageValue(() => 1)?.code).toBe("invalid");
    expect(checkStorageValue(10n)?.code).toBe("invalid");
  });

  it("rejects circular references", () => {
    const o: any = {};
    o.self = o;
    expect(checkStorageValue(o)?.code).toBe("invalid");
  });

  it("accepts a value whose JSON is exactly the max byte size", () => {
    const value = "x".repeat(STORAGE_VALUE_MAX_BYTES - 2);
    expect(checkStorageValue(value)).toBeNull();
  });

  it("rejects a value whose JSON is one byte over the max", () => {
    const value = "x".repeat(STORAGE_VALUE_MAX_BYTES - 1);
    expect(checkStorageValue(value)?.code).toBe("too-large");
  });

  it("rejects a large multibyte string", () => {
    const value = "あ".repeat(400000);
    expect(checkStorageValue(value)?.code).toBe("too-large");
  });
});
