// 共有フォルダの記録と、MOD ごとの ID（folderLog.*・identity.get。ADR 0040）のメッセージの検査と、表示名の整え方
import { describe, expect, it } from "vitest";
import { FOLDER_LOG_RECORD_MAX_BYTES, METHOD_REQUIRES, PROFILE_ICON_MAX, PROFILE_NAME_MAX, USES } from "../src/api/types";
import { checkFolderLogData, checkPermission } from "../src/core/permission";
import { OPENS_HOST_UI } from "../src/core/pointer-lock";
import { normalizeProfile } from "../src/core/profile";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 2, method, params });
const params = (method: string, p: Record<string, unknown>) => {
  const r = call(method, p);
  return r.ok && r.message.kind === "call" ? r.message.params : null;
};
const folder = { id: "v:1", path: "D:\\OneDrive\\ボード" };

describe("uses", () => {
  it("記録には folderLog、ID には identity", () => {
    expect(USES).toContain("folderLog");
    expect(USES).toContain("identity");
    expect(METHOD_REQUIRES["folderLog.append"]).toBe("folderLog");
    expect(METHOD_REQUIRES["folderLog.read"]).toBe("folderLog");
    expect(METHOD_REQUIRES["identity.get"]).toBe("identity");
    expect(checkPermission(["folderData"], "folderLog.append")?.code).toBe("not-declared");
    expect(checkPermission(["folderLog"], "identity.get")?.code).toBe("not-declared");
    expect(checkPermission(["folderLog", "identity"], "identity.get")).toBeNull();
  });

  it("identity.get は初めてのとき本体の画面を出すので、ポインターロックを外してもらう", () => {
    expect(OPENS_HOST_UI.has("identity.get")).toBe(true);
    expect(OPENS_HOST_UI.has("folderLog.append")).toBe(false);
  });
});

describe("folderLog.append", () => {
  it("フォルダと data（中身は本体が後で確かめる）", () => {
    expect(params("folderLog.append", { folder, data: { text: "付箋" } })).toEqual({ folder, data: { text: "付箋" } });
    expect(params("folderLog.append", { folder, data: null })).toEqual({ folder, data: null });
    expect(call("folderLog.append", { folder })).toMatchObject({ ok: false });
    expect(call("folderLog.append", { folder: { path: "C:\\x" }, data: 1 })).toMatchObject({ ok: false });
  });

  it("data は JSON にできて、64KB まで", () => {
    expect(checkFolderLogData({ text: "こんにちは", n: 1 })).toEqual({ json: '{"text":"こんにちは","n":1}' });
    expect(checkFolderLogData("x".repeat(FOLDER_LOG_RECORD_MAX_BYTES - 2))).toHaveProperty("json");
    expect(checkFolderLogData("x".repeat(FOLDER_LOG_RECORD_MAX_BYTES - 1))).toMatchObject({ error: { code: "too-large" } });
    // 日本語は1文字 3 バイトで数える
    expect(checkFolderLogData("あ".repeat(Math.ceil(FOLDER_LOG_RECORD_MAX_BYTES / 3)))).toMatchObject({ error: { code: "too-large" } });
    expect(checkFolderLogData(undefined)).toMatchObject({ error: { code: "invalid" } });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(checkFolderLogData(loop)).toMatchObject({ error: { code: "invalid" } });
  });
});

describe("folderLog.read", () => {
  it("since は前回の cursor（省略できる）", () => {
    expect(params("folderLog.read", { folder })).toEqual({ folder });
    expect(params("folderLog.read", { folder, since: '{"a/2025-10.jsonl":120}' })).toEqual({ folder, since: '{"a/2025-10.jsonl":120}' });
    expect(call("folderLog.read", { folder, since: 120 })).toMatchObject({ ok: false });
    expect(call("folderLog.read", {})).toMatchObject({ ok: false });
  });
});

describe("identity.get", () => {
  it("引数は無い", () => {
    expect(params("identity.get", {})).toEqual({});
  });
});

describe("normalizeProfile", () => {
  it("前後の空白を取り、空なら null", () => {
    expect(normalizeProfile({ name: "  ネオ  ", icon: "🐟" })).toEqual({ name: "ネオ", icon: "🐟" });
    expect(normalizeProfile({ name: "   ", icon: "" })).toEqual({ name: null, icon: null });
    expect(normalizeProfile(null)).toEqual({ name: null, icon: null });
    expect(normalizeProfile([1])).toEqual({ name: null, icon: null });
    expect(normalizeProfile({ name: 3 })).toEqual({ name: null, icon: null });
  });

  it("改行・制御文字・行の区切りを除く（共有フォルダの向こうの画面を崩さないように）", () => {
    expect(normalizeProfile({ name: "ネ\nオ\t\u0000\u2028\u2029" }).name).toBe("ネオ");
  });

  it("長すぎる分は切る（絵文字を途中で割らない）", () => {
    expect([...normalizeProfile({ name: "あ".repeat(PROFILE_NAME_MAX + 5) }).name!]).toHaveLength(PROFILE_NAME_MAX);
    expect([...normalizeProfile({ icon: "🐟".repeat(PROFILE_ICON_MAX + 2) }).icon!]).toHaveLength(PROFILE_ICON_MAX);
  });
});
