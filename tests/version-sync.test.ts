import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getVersion } from "../src/update";

describe("version sync", () => {
  it("package.json version must match src/update.ts VERSION", () => {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const pkgVersion = pkg.version;
    const codeVersion = getVersion();

    expect(codeVersion).toBe(pkgVersion);
    // If this fails, update BOTH package.json and the VERSION const in src/update.ts
  });

  it("src/update.ts VERSION must be a valid semver string", () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
