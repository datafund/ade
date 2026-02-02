import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { detectFormat, output, type Format } from "../src/format";

describe("format", () => {
  describe("detectFormat", () => {
    const originalEnv = process.env.SX_FORMAT;
    const originalIsTTY = process.stdout.isTTY;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.SX_FORMAT = originalEnv;
      } else {
        delete process.env.SX_FORMAT;
      }
      // Note: Can't restore isTTY in tests, but it's read-only anyway
    });

    it("should return explicit format when provided", () => {
      expect(detectFormat("json")).toBe("json");
      expect(detectFormat("human")).toBe("human");
    });

    it("should use SX_FORMAT env var when no explicit format", () => {
      process.env.SX_FORMAT = "json";
      expect(detectFormat()).toBe("json");

      process.env.SX_FORMAT = "human";
      expect(detectFormat()).toBe("human");
    });

    it("should ignore invalid SX_FORMAT values", () => {
      process.env.SX_FORMAT = "invalid";
      // Falls through to TTY detection
      const result = detectFormat();
      expect(result === "json" || result === "human").toBe(true);
    });
  });

  describe("output", () => {
    let consoleSpy: ReturnType<typeof spyOn>;
    let outputLines: string[];

    beforeEach(() => {
      outputLines = [];
      consoleSpy = spyOn(console, "log").mockImplementation((line: string) => {
        outputLines.push(line);
      });
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    describe("json format", () => {
      it("should output JSON with pretty printing", () => {
        const data = { foo: "bar", num: 42 };
        output(data, "json");
        expect(outputLines[0]).toBe(JSON.stringify(data, null, 2));
      });

      it("should output arrays as JSON", () => {
        const data = [{ id: 1 }, { id: 2 }];
        output(data, "json");
        expect(outputLines[0]).toBe(JSON.stringify(data, null, 2));
      });

      it("should output primitives as JSON", () => {
        output("hello", "json");
        expect(outputLines[0]).toBe('"hello"');
      });
    });

    describe("human format", () => {
      it("should print key-value for objects", () => {
        output({ name: "test", count: 5 }, "human");
        expect(outputLines.length).toBe(2);
        expect(outputLines[0]).toContain("name");
        expect(outputLines[0]).toContain("test");
        expect(outputLines[1]).toContain("count");
        expect(outputLines[1]).toContain("5");
      });

      it("should print table for arrays", () => {
        const data = [
          { id: "1", name: "alpha" },
          { id: "2", name: "beta" },
        ];
        output(data, "human");
        // Header + separator + 2 rows
        expect(outputLines.length).toBe(4);
        expect(outputLines[0]).toContain("id");
        expect(outputLines[0]).toContain("name");
        expect(outputLines[1]).toContain("─");
        expect(outputLines[2]).toContain("1");
        expect(outputLines[2]).toContain("alpha");
        expect(outputLines[3]).toContain("2");
        expect(outputLines[3]).toContain("beta");
      });

      it("should print '(no results)' for empty arrays", () => {
        output([], "human");
        expect(outputLines[0]).toBe("(no results)");
      });

      it("should print primitives directly", () => {
        output("hello world", "human");
        expect(outputLines[0]).toBe("hello world");
      });

      it("should handle nested objects in key-value", () => {
        output({ data: { nested: true } }, "human");
        expect(outputLines[0]).toContain('{"nested":true}');
      });

      it("should handle null values in tables", () => {
        const data = [{ id: "1", value: null }];
        output(data, "human");
        expect(outputLines[2]).toContain("1");
      });
    });
  });
});
