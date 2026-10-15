// フォルダの直下の変化のまとめ方（ADR 0023）
import { describe, expect, it } from "vitest";
import { pairChanges } from "../src/core/changes";

describe("pairChanges", () => {
  it("前の名前・後の名前を、1つの renamed にする", () => {
    expect(pairChanges([{ kind: "renamedFrom", path: "C:\\A\\old.txt" }, { kind: "renamedTo", path: "C:\\A\\new.txt" }])).toEqual([
      { kind: "renamed", path: "C:\\A\\new.txt", name: "new.txt", from: "C:\\A\\old.txt" },
    ]);
  });

  it("相手のいない前の名前は removed、後の名前は created", () => {
    expect(pairChanges([{ kind: "renamedFrom", path: "C:\\A\\gone" }, { kind: "created", path: "C:\\A\\x" }])).toEqual([
      { kind: "removed", path: "C:\\A\\gone", name: "gone" },
      { kind: "created", path: "C:\\A\\x", name: "x" },
    ]);
    expect(pairChanges([{ kind: "renamedTo", path: "C:\\A\\came" }])).toEqual([{ kind: "created", path: "C:\\A\\came", name: "came" }]);
    expect(pairChanges([{ kind: "renamedFrom", path: "C:\\A\\last" }])).toEqual([{ kind: "removed", path: "C:\\A\\last", name: "last" }]);
  });

  it("作った直後・続けての書き換えは1つにまとめる。知らない種類は捨てる", () => {
    expect(
      pairChanges([
        { kind: "created", path: "C:\\A\\a" },
        { kind: "modified", path: "C:\\A\\a" },
        { kind: "modified", path: "C:\\A\\b" },
        { kind: "modified", path: "C:\\A\\b" },
        { kind: "other", path: "C:\\A\\c" },
      ]),
    ).toEqual([
      { kind: "created", path: "C:\\A\\a", name: "a" },
      { kind: "modified", path: "C:\\A\\b", name: "b" },
    ]);
  });

  it("from 付きの renamed はそのまま", () => {
    expect(pairChanges([{ kind: "renamed", path: "C:\\A\\n", from: "C:\\A\\o" }])).toEqual([{ kind: "renamed", path: "C:\\A\\n", name: "n", from: "C:\\A\\o" }]);
  });
});
