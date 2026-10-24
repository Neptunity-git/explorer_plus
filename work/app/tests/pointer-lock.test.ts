import { describe, it, expect } from "vitest";
import { USES } from "../src/api/types";
import { validateManifest } from "../src/core/manifest";
import { OPENS_HOST_UI, sandboxFor } from "../src/core/pointer-lock";

describe("sandboxFor (ADR 0039)", () => {
  it("pointerLock を宣言していなければ allow-scripts だけ", () => {
    expect(sandboxFor([], false)).toBe("allow-scripts");
    expect(sandboxFor(["entries", "collections"], false)).toBe("allow-scripts");
  });

  it("pointerLock を宣言すると allow-pointer-lock が付く", () => {
    expect(sandboxFor(["pointerLock"], false)).toBe("allow-scripts allow-pointer-lock");
    expect(sandboxFor(["entries", "pointerLock"], false)).toBe("allow-scripts allow-pointer-lock");
  });

  it("見えない所で動かす MOD には、宣言していても付けない", () => {
    expect(sandboxFor(["pointerLock"], true)).toBe("allow-scripts");
  });

  it("allow-same-origin は、どの場合も付けない", () => {
    for (const uses of [[], ["pointerLock"], [...USES]] as const) {
      for (const background of [false, true]) {
        expect(sandboxFor(uses, background)).not.toContain("allow-same-origin");
      }
    }
  });
});

describe("OPENS_HOST_UI", () => {
  it("本体が確かめ・メニューなどの画面を出す呼びかけが入っている", () => {
    for (const m of ["ui.confirm", "ui.ask", "ui.choose", "showMenu", "trash", "collections.delete", "files.create", "files.createShortcut"]) {
      expect(OPENS_HOST_UI.has(m)).toBe(true);
    }
  });

  it("画面を出さない呼びかけは入っていない", () => {
    for (const m of ["ready", "ui.toast", "ui.status", "storage.get", "navigate"]) {
      expect(OPENS_HOST_UI.has(m)).toBe(false);
    }
  });
});

describe("manifest の uses に pointerLock", () => {
  const base = { id: "test-mod", name: "Test Mod", version: "1.0.0", apiVersion: 1, entry: "index.js" };

  it("USES に入っている", () => {
    expect(USES).toContain("pointerLock");
  });

  it("宣言できる", () => {
    const result = validateManifest({ ...base, uses: ["pointerLock"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.uses).toEqual(["pointerLock"]);
  });

  it("名前の綴りが違うとエラー", () => {
    const result = validateManifest({ ...base, uses: ["pointerlock"] });
    expect(result.ok).toBe(false);
  });
});
