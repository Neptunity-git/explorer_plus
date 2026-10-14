import { describe, it, expect } from "vitest";
import { splitPath, parseCommandLine } from "../src/core/paths";

describe("splitPath", () => {
  it("splits a normal drive path", () => {
    expect(splitPath("C:\\Users\\neo_m\\Documents")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "neo_m", path: "C:\\Users\\neo_m" },
      { label: "Documents", path: "C:\\Users\\neo_m\\Documents" },
    ]);
  });

  it("handles a bare drive root", () => {
    expect(splitPath("C:\\")).toEqual([{ label: "C:", path: "C:\\" }]);
  });

  it("uppercases the drive letter and adds a backslash", () => {
    expect(splitPath("d:")).toEqual([{ label: "D:", path: "D:\\" }]);
  });

  it("ignores trailing and consecutive backslashes", () => {
    expect(splitPath("C:\\a\\\\b\\")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "a", path: "C:\\a" },
      { label: "b", path: "C:\\a\\b" },
    ]);
  });

  it("handles non-ASCII segments", () => {
    expect(splitPath("C:\\学業\\A校")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "学業", path: "C:\\学業" },
      { label: "A校", path: "C:\\学業\\A校" },
    ]);
  });

  it("returns empty for non-drive inputs", () => {
    expect(splitPath("")).toEqual([]);
    expect(splitPath("\\\\server\\share")).toEqual([]);
    expect(splitPath("relative\\x")).toEqual([]);
  });
});

describe("parseCommandLine", () => {
  it("parses a bare command", () => {
    expect(parseCommandLine("cmd")).toEqual({ file: "cmd", args: "" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCommandLine("  code .  ")).toEqual({ file: "code", args: "." });
  });

  it("keeps multiple args intact", () => {
    expect(parseCommandLine("powershell -NoExit -Command dir")).toEqual({
      file: "powershell",
      args: "-NoExit -Command dir",
    });
  });

  it("parses a quoted file path with spaces", () => {
    expect(
      parseCommandLine('"C:\\Program Files\\Tool\\tool.exe" --open a.txt')
    ).toEqual({
      file: "C:\\Program Files\\Tool\\tool.exe",
      args: "--open a.txt",
    });
  });

  it("splits on a tab as well as a space", () => {
    expect(parseCommandLine("notepad\tmemo.txt")).toEqual({
      file: "notepad",
      args: "memo.txt",
    });
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(parseCommandLine("")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
  });

  it("returns null for an unclosed quote", () => {
    expect(parseCommandLine('"unclosed')).toBeNull();
  });

  it("returns null for an empty quoted file", () => {
    expect(parseCommandLine('"" x')).toBeNull();
  });
});
