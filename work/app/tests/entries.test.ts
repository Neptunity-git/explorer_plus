import { describe, it, expect } from "vitest";
import { extOf, iconKindFor, sortEntries } from "../src/core/entries";
import type { Entry } from "../src/api/types";

function entry(name: string, kind: "file" | "folder"): Entry {
  return { id: "0000000000000000:00000000000000000000000000000000", name, path: name, kind, ext: "", hidden: false };
}

describe("extOf", () => {
  it("returns the lowercased extension after the last dot", () => {
    expect(extOf("report.DOCX")).toBe("docx");
    expect(extOf("archive.tar.gz")).toBe("gz");
  });

  it("returns an empty string when there is no extension", () => {
    expect(extOf("README")).toBe("");
    expect(extOf("file.")).toBe("");
    expect(extOf("")).toBe("");
  });

  it("treats a leading dot as an extension separator", () => {
    expect(extOf(".gitignore")).toBe("gitignore");
  });
});

describe("iconKindFor", () => {
  it("returns launch for executable extensions", () => {
    expect(iconKindFor("file", "exe")).toBe("launch");
    expect(iconKindFor("file", "lnk")).toBe("launch");
  });

  it("returns config for configuration extensions", () => {
    expect(iconKindFor("file", "yaml")).toBe("config");
    expect(iconKindFor("file", "json")).toBe("config");
  });

  it("returns system for other files and all folders", () => {
    expect(iconKindFor("file", "docx")).toBe("system");
    expect(iconKindFor("file", "")).toBe("system");
    expect(iconKindFor("folder", "exe")).toBe("system");
  });
});

describe("sortEntries", () => {
  it("sorts folders first, then files, using numeric and case-insensitive name comparison", () => {
    const input: Entry[] = [
      entry("file10.txt", "file"),
      entry("b", "folder"),
      entry("file2.txt", "file"),
      entry("File1.txt", "file"),
      entry("A", "folder"),
    ];
    const result = sortEntries(input);
    expect(result.map((e) => e.name)).toEqual(["A", "b", "File1.txt", "file2.txt", "file10.txt"]);
  });

  it("breaks ties with raw string comparison and keeps original order for identical names", () => {
    const input: Entry[] = [entry("a.txt", "file"), entry("A.txt", "file")];
    const result = sortEntries(input);
    expect(result.map((e) => e.name)).toEqual(["A.txt", "a.txt"]);
  });

  it("does not mutate the input array", () => {
    const input: Entry[] = [
      entry("file10.txt", "file"),
      entry("b", "folder"),
      entry("file2.txt", "file"),
      entry("File1.txt", "file"),
      entry("A", "folder"),
    ];
    const before = input.map((e) => e.name);
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(before);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortEntries([])).toEqual([]);
  });
});
