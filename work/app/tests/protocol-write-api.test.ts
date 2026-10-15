// 書き込みとコレクション（files.create・createShortcut・collections.*。ADR 0025）のメッセージの検査
import { describe, expect, it } from "vitest";
import { METHOD_REQUIRES } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 2, method, params });
const params = (method: string, p: Record<string, unknown>) => {
  const r = call(method, p);
  return r.ok && r.message.kind === "call" ? r.message.params : null;
};
const folder = { id: "v:1", path: "C:\\作業" };
const target = { id: "v:2", path: "C:\\作業\\a.txt" };

describe("uses", () => {
  it("作るには createFiles、コレクションには collections", () => {
    expect(METHOD_REQUIRES["files.create"]).toBe("createFiles");
    expect(METHOD_REQUIRES["files.createShortcut"]).toBe("createFiles");
    expect(METHOD_REQUIRES["collections.add"]).toBe("collections");
  });
});

describe("files.create", () => {
  it("名前・種類・中身（text か bytes のどちらか）", () => {
    expect(params("files.create", { folder, name: "メモ.txt", text: "本文" })).toEqual({ folder, name: "メモ.txt", kind: "file", text: "本文" });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(params("files.create", { folder, name: "a.bin", bytes })).toEqual({ folder, name: "a.bin", kind: "file", bytes });
    expect(params("files.create", { folder, name: "新しい部屋", kind: "folder" })).toEqual({ folder, name: "新しい部屋", kind: "folder" });
    expect(call("files.create", { folder, name: "a", text: "x", bytes })).toMatchObject({ ok: false });
    expect(call("files.create", { folder, name: "a", kind: "folder", text: "x" })).toMatchObject({ ok: false });
    expect(call("files.create", { folder, name: "a", kind: "link" })).toMatchObject({ ok: false });
    expect(call("files.create", { folder, name: "" })).toMatchObject({ ok: false });
    expect(call("files.create", { folder, name: "a", bytes: [1, 2] })).toMatchObject({ ok: false });
  });

  it("createShortcut", () => {
    expect(params("files.createShortcut", { folder, target })).toEqual({ folder, target });
    expect(params("files.createShortcut", { folder, target, name: "近道" })).toEqual({ folder, target, name: "近道" });
    expect(call("files.createShortcut", { folder })).toMatchObject({ ok: false });
  });
});

describe("collections.*", () => {
  it("作る・変える・消す・入れる", () => {
    expect(params("collections.create", { name: "旅行", color: "#57ab5a" })).toEqual({ name: "旅行", color: "#57ab5a" });
    expect(call("collections.create", { name: "旅行", color: "green" })).toMatchObject({ ok: false });
    expect(call("collections.create", {})).toMatchObject({ ok: false });
    expect(params("collections.update", { id: "col-1", name: "夏" })).toEqual({ id: "col-1", name: "夏" });
    expect(call("collections.update", { name: "夏" })).toMatchObject({ ok: false });
    expect(params("collections.delete", { id: "col-1" })).toEqual({ id: "col-1" });
    expect(params("collections.add", { id: "col-1", items: [target] })).toEqual({ id: "col-1", items: [target] });
    expect(call("collections.add", { id: "col-1", items: [] })).toMatchObject({ ok: false });
    expect(params("collections.entries", { id: "col-1" })).toEqual({ id: "col-1" });
    expect(params("collections.list", {})).toEqual({});
  });
});
