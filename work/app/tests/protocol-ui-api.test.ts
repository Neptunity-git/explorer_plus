// 本体の画面を使う API（ui.*・settings.get・commands.set。ADR 0024）のメッセージの検査
import { describe, expect, it } from "vitest";
import { METHOD_REQUIRES } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 9, method, params });
const params = (method: string, p: Record<string, unknown>) => {
  const r = call(method, p);
  return r.ok && r.message.kind === "call" ? r.message.params : null;
};

describe("ui.*", () => {
  it("uses は要らない", () => {
    for (const m of ["ui.toast", "ui.status", "ui.tab", "ui.confirm", "ui.ask", "ui.choose", "settings.get", "commands.set"] as const) expect(METHOD_REQUIRES[m]).toBeNull();
  });

  it("toast・status は長さの上限", () => {
    expect(params("ui.toast", { text: "保存しました" })).toEqual({ text: "保存しました" });
    expect(call("ui.toast", { text: "" }).ok).toBe(false);
    expect(call("ui.toast", { text: "x".repeat(201) }).ok).toBe(false);
    expect(params("ui.status", { text: null })).toEqual({ text: null });
    expect(call("ui.status", { text: "x".repeat(121) }).ok).toBe(false);
  });

  it("tab は title・badge を null で戻せる。省略は変えない", () => {
    expect(params("ui.tab", { title: "提出物", badge: "3" })).toEqual({ title: "提出物", badge: "3" });
    expect(params("ui.tab", { badge: null })).toEqual({ badge: null });
    expect(params("ui.tab", {})).toEqual({});
    expect(call("ui.tab", { badge: "123456789" }).ok).toBe(false);
  });

  it("confirm・ask", () => {
    expect(params("ui.confirm", { message: "消しますか？", okLabel: "消す" })).toEqual({ message: "消しますか？", okLabel: "消す" });
    expect(call("ui.confirm", { message: "" }).ok).toBe(false);
    expect(params("ui.ask", { label: "名前", value: "a", extra: 1 })).toEqual({ label: "名前", value: "a" });
    expect(call("ui.ask", {}).ok).toBe(false);
  });

  it("choose・commands.set は id と label の並び", () => {
    const items = [{ id: "a", label: "A", hint: "ヒント" }, { id: "b", label: "B" }];
    expect(params("ui.choose", { items, title: "選ぶ" })).toEqual({ items, title: "選ぶ" });
    expect(call("ui.choose", { items: [] }).ok).toBe(false);
    expect(call("ui.choose", { items: [{ id: "", label: "A" }] }).ok).toBe(false);
    expect(params("commands.set", { commands: [] })).toEqual({ commands: [] });
    expect(params("commands.set", { commands: items })).toEqual({ commands: items });
    expect(call("commands.set", { commands: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, label: "x" })) }).ok).toBe(false);
  });
});
