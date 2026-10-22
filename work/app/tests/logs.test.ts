// ログ（ADR 0029）：1件の形・覚えておく数・出しすぎの抑え・操作の説明・メッセージの検査
import { describe, expect, it } from "vitest";
import { LogLimiter, LogRing, clip, describeCommand, describeModCall, formatTime, fromLine, quietFailure, toLine, toText, urlForLog } from "../src/core/logs";
import { parseModMessage } from "../src/core/protocol";
import { METHOD_REQUIRES } from "../src/api/types";

describe("1件の形", () => {
  it("ファイルの1行と行き来できる。壊れた行は捨てる", () => {
    const e = { t: 1, level: "warn" as const, source: "my.view", text: "あ\nい" };
    expect(fromLine(toLine(e), "my.view")).toEqual(e);
    expect(toLine(e)).not.toContain("\n");
    expect(fromLine("{broken", "app")).toBeNull();
    expect(fromLine(JSON.stringify({ t: 1, level: "debug", text: "x" }), "app")).toBeNull();
  });

  it("長すぎる文は切る", () => {
    expect(clip("x".repeat(10), 4)).toBe("xxxx…（6 文字省略）");
    expect(clip("abc", 4)).toBe("abc");
  });
});

describe("文字のファイル（ADR 0038）", () => {
  const at = (h: number, m: number, s: number, ms: number) => new Date(2026, 9, 22, h, m, s, ms).getTime();
  const log = (t: number, level: "info" | "warn" | "error", text: string) => ({ t, level, source: "my.view", text });

  it("時刻は、この PC の時刻で、日付つき", () => {
    expect(formatTime(at(9, 5, 3, 7))).toBe("2026-10-22 09:05:03.007");
  });

  it("1件が1行。本文が何行かあるときは、2行目からを字下げする", () => {
    const text = toText([log(at(1, 2, 3, 4), "info", "hello"), log(at(1, 2, 4, 0), "error", "boom\nat a.js:1\r\nat b.js:2")]);
    expect(text).toBe(
      "2026-10-22 01:02:03.004 [info] hello\r\n" + "2026-10-22 01:02:04.000 [error] boom\r\n    at a.js:1\r\n    at b.js:2\r\n",
    );
  });

  it("出す重さで絞れる。何も無ければ空", () => {
    const list = [log(1, "info", "a"), log(2, "warn", "b"), log(3, "error", "c")];
    expect(toText(list, "warn").split("\r\n").filter(Boolean)).toHaveLength(2);
    expect(toText(list, "error")).toContain("[error] c");
    expect(toText(list, "error")).not.toContain("[warn]");
    expect(toText([])).toBe("");
  });
});

describe("LogRing", () => {
  it("決まった数だけ覚え、古いものから捨てる。ファイルの分は前に足す", () => {
    const r = new LogRing(3);
    for (const t of [1, 2, 3, 4]) r.add({ t, level: "info", source: "app", text: String(t) });
    expect(r.list().map((e) => e.t)).toEqual([2, 3, 4]);
    r.prepend([{ t: 0, level: "info", source: "app", text: "0" }]);
    expect(r.list().map((e) => e.t)).toEqual([2, 3, 4]);
    const s = new LogRing(5);
    s.add({ t: 9, level: "info", source: "app", text: "" });
    s.prepend([{ t: 1, level: "info", source: "app", text: "" }]);
    expect(s.list().map((e) => e.t)).toEqual([1, 9]);
  });
});

describe("LogLimiter", () => {
  it("決まった時間に決まった数まで。超えた最初の1件だけ知らせる", () => {
    const l = new LogLimiter(2, 1000);
    expect([l.allow(0), l.allow(1), l.allow(2), l.allow(3)]).toEqual(["ok", "ok", "first-drop", "drop"]);
    expect(l.allow(1000)).toBe("ok");
  });
});

describe("本体の操作の説明", () => {
  it("ファイルを変える操作を、分かる言葉にする", () => {
    expect(describeCommand("transfer", { items: [{ path: "C:\\a\\x.txt" }], dest: "C:\\b", effect: "copy" })).toBe("コピー：x.txt → C:\\b");
    expect(describeCommand("trash_entries", { items: ["a", "b", "c", "d"].map((n) => ({ path: `C:\\${n}` })) })).toBe("ごみ箱へ：a、b、c ほか 1 個");
    expect(describeCommand("list_dir", { path: "C:\\" })).toBeNull();
  });

  it("秘密の値は書かない", () => {
    const text = describeCommand("secret_set", { viewId: "my.view", key: "apiKey", value: "sk-SECRET" })!;
    expect(text).not.toContain("SECRET");
    expect(text).toContain("apiKey");
  });

  it("やめた・あるかの確かめは、失敗として残さない", () => {
    expect(quietFailure("transfer", "denied")).toBe(true);
    expect(quietFailure("resolve", "not-found")).toBe(true);
    expect(quietFailure("transfer", "io")).toBe(false);
  });
});

describe("MOD が頼んだことの説明", () => {
  it("通信は、問い合わせの中身（? より後）を書かない", () => {
    expect(urlForLog("https://api.example.com/w?q=tokyo&key=x")).toBe("https://api.example.com/w?…");
    expect(describeModCall("net.fetch", { url: "https://a.com/x?k=1", method: "POST", secret: "apiKey" }, { status: 201 })).toBe(
      "通信：POST https://a.com/x?…（秘密の設定 apiKey を付けた） → 201",
    );
  });

  it("名前の変更・作る", () => {
    expect(describeModCall("rename", { id: "1", path: "C:\\a.txt", newName: "b.txt" }, null)).toBe("名前の変更：C:\\a.txt → b.txt");
    expect(describeModCall("files.create", { folder: { id: "1", path: "C:\\d" }, name: "n.txt" }, null)).toBe("作る：C:\\d\\n.txt");
    expect(describeModCall("storage.get", {}, null)).toBeNull();
  });
});

describe("メッセージ", () => {
  it("MOD の console.log は kind: log で届く", () => {
    const r = parseModMessage({ ep: 1, kind: "log", level: "error", text: "boom" });
    expect(r.ok && r.message).toEqual({ ep: 1, kind: "log", level: "error", text: "boom" });
    expect(parseModMessage({ ep: 1, kind: "log", level: "debug", text: "x" }).ok).toBe(false);
    expect(parseModMessage({ ep: 1, kind: "log", level: "info", text: 1 }).ok).toBe(false);
  });

  it("logs.* と mods.openSettings", () => {
    const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 1, method, params });
    expect(call("logs.list", { source: "app" }).ok).toBe(true);
    expect(call("logs.list", {}).ok).toBe(false);
    expect(call("logs.sources", {}).ok).toBe(true);
    expect(call("mods.openSettings", { id: "my.view" }).ok).toBe(true);
    expect(METHOD_REQUIRES["logs.list"]).toBeNull();
  });

  it("logs.openFile・logs.openFolder（ADR 0038）", () => {
    const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 1, method, params });
    const ok = call("logs.openFile", { source: "my.view", level: "warn" });
    expect(ok.ok && ok.message).toMatchObject({ params: { source: "my.view", level: "warn" } });
    expect(call("logs.openFile", { source: "app" }).ok).toBe(true);
    expect(call("logs.openFile", {}).ok).toBe(false);
    expect(call("logs.openFile", { source: "app", level: "debug" }).ok).toBe(false);
    expect(call("logs.openFolder", {}).ok).toBe(true);
    expect(METHOD_REQUIRES["logs.openFile"]).toBeNull();
    expect(METHOD_REQUIRES["logs.openFolder"]).toBeNull();
  });
});
