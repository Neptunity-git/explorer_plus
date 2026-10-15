// 読み取りの API（files.*・search.*・system.*。ADR 0023）のメッセージの検査
import { describe, expect, it } from "vitest";
import { METHOD_REQUIRES } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 5, method, params });
const params = (method: string, p: Record<string, unknown>) => {
  const r = call(method, p);
  return r.ok && r.message.kind === "call" ? r.message.params : null;
};
const item = { id: "v:1", path: "C:\\a.jpg" };
const folder = { id: "v:2", path: "C:\\写真" };

describe("uses", () => {
  it("それぞれの宣言が要る", () => {
    expect(METHOD_REQUIRES["files.readText"]).toBe("fileContent");
    expect(METHOD_REQUIRES["files.url"]).toBe("fileContent");
    expect(METHOD_REQUIRES["files.info"]).toBe("fileInfo");
    expect(METHOD_REQUIRES["search.find"]).toBe("search");
    expect(METHOD_REQUIRES["system.drives"]).toBe("system");
  });
});

describe("files.*", () => {
  it("readText・readBytes は既定の大きさを入れ、上限を超えたら誤り", () => {
    expect(params("files.readText", { item })).toEqual({ item, offset: 0, maxBytes: 1024 * 1024 });
    expect(params("files.readBytes", { item, offset: 10, length: 5 })).toEqual({ item, offset: 10, length: 5 });
    expect(call("files.readText", { item, maxBytes: 9 * 1024 * 1024 }).ok).toBe(false);
    expect(call("files.readBytes", { item, length: 0 }).ok).toBe(false);
    expect(call("files.readBytes", { item, offset: -1 }).ok).toBe(false);
    expect(call("files.readText", { item: { path: "x" } }).ok).toBe(false);
  });

  it("url・info・properties", () => {
    expect(params("files.url", { item })).toEqual({ item });
    expect(params("files.info", { items: [item] })).toEqual({ items: [item] });
    expect(call("files.info", { items: [] }).ok).toBe(false);
    expect(params("files.properties", { items: [item], names: ["System.Photo.DateTaken"] })).toEqual({ items: [item], names: ["System.Photo.DateTaken"] });
    expect(call("files.properties", { items: [item], names: ["Photo.DateTaken"] }).ok).toBe(false);
    expect(call("files.properties", { items: [item], names: ["System.A;B"] }).ok).toBe(false);
  });
});

describe("search.*", () => {
  it("条件は知っている項目だけを、形を確かめて取り出す", () => {
    expect(params("search.find", { folder, query: { name: "*.jpg", ext: ["jpg"], kind: "file", minSize: 10, hidden: false, extra: 1 }, depth: 3, limit: 50 })).toEqual({
      folder,
      query: { name: "*.jpg", ext: ["jpg"], kind: "file", minSize: 10, hidden: false },
      depth: 3,
      limit: 50,
    });
    expect(params("search.find", { folder })).toEqual({ folder, query: {}, depth: undefined, limit: undefined });
    expect(call("search.find", { folder, query: { kind: "link" } }).ok).toBe(false);
    expect(call("search.find", { folder, query: { minSize: -1 } }).ok).toBe(false);
    expect(call("search.find", { folder, limit: 6000 }).ok).toBe(false);
    expect(call("search.find", { folder, depth: 0 }).ok).toBe(false);
    expect(params("search.stats", { folder, depth: 2 })).toEqual({ folder, depth: 2 });
  });
});

describe("system.*", () => {
  it("引数なし", () => {
    expect(params("system.drives", { x: 1 })).toEqual({});
    expect(params("system.info", {})).toEqual({});
  });
});
