import { describe, it, expect } from "bun:test";
import { parseArgs, type ParsedCommand } from "../src/routing";

describe("routing", () => {
  describe("parseArgs", () => {
    describe("secrets commands", () => {
      it("should parse 'set <key>'", () => {
        const result = parseArgs(["set", "MY_SECRET"]);
        expect(result).toEqual({
          type: "secrets",
          command: "set",
          args: ["MY_SECRET"],
          flags: {},
        });
      });

      it("should parse 'get <key>'", () => {
        const result = parseArgs(["get", "MY_SECRET"]);
        expect(result).toEqual({
          type: "secrets",
          command: "get",
          args: ["MY_SECRET"],
          flags: {},
        });
      });

      it("should parse 'rm <key>'", () => {
        const result = parseArgs(["rm", "MY_SECRET"]);
        expect(result).toEqual({
          type: "secrets",
          command: "rm",
          args: ["MY_SECRET"],
          flags: {},
        });
      });

      it("should parse 'ls'", () => {
        const result = parseArgs(["ls"]);
        expect(result).toEqual({
          type: "secrets",
          command: "ls",
          args: [],
          flags: {},
        });
      });
    });

    describe("resource commands", () => {
      it("should parse 'skills list'", () => {
        const result = parseArgs(["skills", "list"]);
        expect(result).toEqual({
          type: "resource",
          resource: "skills",
          action: "list",
          args: [],
          flags: {},
        });
      });

      it("should parse 'skills show <id>'", () => {
        const result = parseArgs(["skills", "show", "skill-123"]);
        expect(result).toEqual({
          type: "resource",
          resource: "skills",
          action: "show",
          args: ["skill-123"],
          flags: {},
        });
      });

      it("should parse 'skills vote <id> <direction>'", () => {
        const result = parseArgs(["skills", "vote", "skill-123", "up"]);
        expect(result).toEqual({
          type: "resource",
          resource: "skills",
          action: "vote",
          args: ["skill-123", "up"],
          flags: {},
        });
      });

      it("should parse flags with values", () => {
        const result = parseArgs(["skills", "list", "--category", "ai", "--limit", "10"]);
        expect(result).toEqual({
          type: "resource",
          resource: "skills",
          action: "list",
          args: [],
          flags: { category: "ai", limit: "10" },
        });
      });

      it("should parse boolean flags", () => {
        const result = parseArgs(["escrows", "create", "--yes"]);
        expect(result).toEqual({
          type: "resource",
          resource: "escrows",
          action: "create",
          args: [],
          flags: { yes: true },
        });
      });

      it("should parse escrows with all flags", () => {
        const result = parseArgs([
          "escrows",
          "create",
          "--content-hash",
          "0xabc",
          "--price",
          "0.1",
          "--yes",
        ]);
        expect(result).toEqual({
          type: "resource",
          resource: "escrows",
          action: "create",
          args: [],
          flags: { "content-hash": "0xabc", price: "0.1", yes: true },
        });
      });

      it("should parse bounties list with filters", () => {
        const result = parseArgs(["bounties", "list", "--status", "open"]);
        expect(result).toEqual({
          type: "resource",
          resource: "bounties",
          action: "list",
          args: [],
          flags: { status: "open" },
        });
      });

      it("should parse agents list with sort", () => {
        const result = parseArgs(["agents", "list", "--sort", "reputation"]);
        expect(result).toEqual({
          type: "resource",
          resource: "agents",
          action: "list",
          args: [],
          flags: { sort: "reputation" },
        });
      });

      it("should parse config show", () => {
        const result = parseArgs(["config", "show"]);
        expect(result).toEqual({
          type: "resource",
          resource: "config",
          action: "show",
          args: [],
          flags: {},
        });
      });
    });

    describe("meta commands", () => {
      it("should parse 'stats'", () => {
        const result = parseArgs(["stats"]);
        expect(result).toEqual({
          type: "meta",
          command: "stats",
          args: [],
          flags: {},
        });
      });

      it("should parse 'schema'", () => {
        const result = parseArgs(["schema"]);
        expect(result).toEqual({
          type: "meta",
          command: "schema",
          args: [],
          flags: {},
        });
      });

      it("should parse 'version'", () => {
        const result = parseArgs(["version"]);
        expect(result).toEqual({
          type: "meta",
          command: "version",
          args: [],
          flags: {},
        });
      });

      it("should parse '--version'", () => {
        const result = parseArgs(["--version"]);
        expect(result).toEqual({
          type: "meta",
          command: "version",
          args: [],
          flags: {},
        });
      });

      it("should parse '-v'", () => {
        const result = parseArgs(["-v"]);
        expect(result).toEqual({
          type: "meta",
          command: "version",
          args: [],
          flags: {},
        });
      });

      it("should parse 'update'", () => {
        const result = parseArgs(["update"]);
        expect(result).toEqual({
          type: "meta",
          command: "update",
          args: [],
          flags: {},
        });
      });

      it("should parse 'watch' as meta command", () => {
        const result = parseArgs(["watch"]);
        expect(result).toEqual({
          type: "meta",
          command: "watch",
          args: [],
          flags: {},
        });
      });

      it("should parse 'watch' with flags", () => {
        const result = parseArgs(["watch", "--yes", "--max-value", "0.1", "--once"]);
        expect(result).toEqual({
          type: "meta",
          command: "watch",
          args: [],
          flags: { yes: true, "max-value": "0.1", once: true },
        });
      });

      it("should parse 'scan-bounties' as meta command", () => {
        const result = parseArgs(["scan-bounties", "--dir", "./data"]);
        expect(result).toEqual({
          type: "meta",
          command: "scan-bounties",
          args: [],
          flags: { dir: "./data" },
        });
      });

      it("should parse 'scan-bounties' with respond flags", () => {
        const result = parseArgs(["scan-bounties", "--dir", "./data", "--respond", "--yes", "--max-value", "0.05"]);
        expect(result).toEqual({
          type: "meta",
          command: "scan-bounties",
          args: [],
          flags: { dir: "./data", respond: true, yes: true, "max-value": "0.05" },
        });
      });

      it("should parse 'sell' with --dir flag", () => {
        const result = parseArgs(["sell", "--dir", "./data", "--price", "0.1", "--yes"]);
        expect(result).toEqual({
          type: "meta",
          command: "sell",
          args: [],
          flags: { dir: "./data", price: "0.1", yes: true },
        });
      });
    });

    describe("help commands", () => {
      it("should parse 'help'", () => {
        const result = parseArgs(["help"]);
        expect(result).toEqual({
          type: "help",
          topic: undefined,
          subtopic: undefined,
        });
      });

      it("should parse 'help skills'", () => {
        const result = parseArgs(["help", "skills"]);
        expect(result).toEqual({
          type: "help",
          topic: "skills",
          subtopic: undefined,
        });
      });

      it("should parse 'help escrows create'", () => {
        const result = parseArgs(["help", "escrows", "create"]);
        expect(result).toEqual({
          type: "help",
          topic: "escrows",
          subtopic: "create",
        });
      });

      it("should parse '--help' flag on any command", () => {
        const result = parseArgs(["skills", "--help"]);
        expect(result).toEqual({
          type: "help",
          topic: "skills",
          subtopic: undefined,
        });
      });

      it("should parse '--help' flag on subcommand", () => {
        const result = parseArgs(["escrows", "create", "--help"]);
        expect(result).toEqual({
          type: "help",
          topic: "escrows",
          subtopic: "create",
        });
      });

      it("should parse '-h' flag", () => {
        const result = parseArgs(["bounties", "-h"]);
        expect(result).toEqual({
          type: "help",
          topic: "bounties",
          subtopic: undefined,
        });
      });
    });

    describe("format flag", () => {
      it("should extract --format flag", () => {
        const result = parseArgs(["skills", "list", "--format", "json"]);
        expect(result.flags?.format).toBe("json");
      });

      it("should extract --format=value syntax", () => {
        const result = parseArgs(["skills", "list", "--format=human"]);
        expect(result.flags?.format).toBe("human");
      });
    });

    describe("empty/unknown commands", () => {
      it("should return help for no arguments", () => {
        const result = parseArgs([]);
        expect(result).toEqual({
          type: "help",
          topic: undefined,
          subtopic: undefined,
        });
      });

      it("should return unknown for unrecognized command", () => {
        const result = parseArgs(["foobar"]);
        expect(result).toEqual({
          type: "unknown",
          command: "foobar",
        });
      });

      it("should return unknown for unrecognized resource", () => {
        const result = parseArgs(["widgets", "list"]);
        expect(result).toEqual({
          type: "unknown",
          command: "widgets",
        });
      });
    });
  });
});
