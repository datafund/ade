import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { showHelp, showResourceHelp, showActionHelp } from "../src/help";

describe("help", () => {
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

  const getOutput = () => outputLines.join("\n");

  describe("showHelp", () => {
    it("should display main help overview", () => {
      showHelp();
      const output = getOutput();

      expect(output).toContain("ade");
      expect(output).toContain("Secret Vault");
      expect(output).toContain("Skill Exchange");
    });

    it("should list secrets commands", () => {
      showHelp();
      const output = getOutput();

      expect(output).toContain("set");
      expect(output).toContain("get");
      expect(output).toContain("rm");
      expect(output).toContain("ls");
    });

    it("should list resource commands", () => {
      showHelp();
      const output = getOutput();

      expect(output).toContain("skills");
      expect(output).toContain("bounties");
      expect(output).toContain("agents");
      expect(output).toContain("escrows");
      expect(output).toContain("wallets");
    });

    it("should list meta commands", () => {
      showHelp();
      const output = getOutput();

      expect(output).toContain("stats");
      expect(output).toContain("schema");
      expect(output).toContain("version");
      expect(output).toContain("update");
    });

    it("should show how to get more help", () => {
      showHelp();
      const output = getOutput();

      expect(output).toContain("help");
      expect(output).toContain("--help");
    });
  });

  describe("showResourceHelp", () => {
    it("should show skills help with all actions", () => {
      showResourceHelp("skills");
      const output = getOutput();

      expect(output).toContain("skills");
      expect(output).toContain("list");
      expect(output).toContain("show");
      expect(output).toContain("vote");
      expect(output).toContain("comment");
      expect(output).toContain("create");
    });

    it("should show bounties help", () => {
      showResourceHelp("bounties");
      const output = getOutput();

      expect(output).toContain("bounties");
      expect(output).toContain("list");
      expect(output).toContain("show");
      expect(output).toContain("create");
    });

    it("should show escrows help with all actions", () => {
      showResourceHelp("escrows");
      const output = getOutput();

      expect(output).toContain("escrows");
      expect(output).toContain("list");
      expect(output).toContain("show");
      expect(output).toContain("create");
      expect(output).toContain("fund");
      expect(output).toContain("commit-key");
      expect(output).toContain("reveal-key");
      expect(output).toContain("claim");
    });

    it("should show agents help", () => {
      showResourceHelp("agents");
      const output = getOutput();

      expect(output).toContain("agents");
      expect(output).toContain("list");
      expect(output).toContain("show");
    });

    it("should show wallets help", () => {
      showResourceHelp("wallets");
      const output = getOutput();

      expect(output).toContain("wallets");
      expect(output).toContain("list");
    });

    it("should show config help", () => {
      showResourceHelp("config");
      const output = getOutput();

      expect(output).toContain("config");
      expect(output).toContain("show");
    });

    it("should indicate unknown resource", () => {
      showResourceHelp("unknown");
      const output = getOutput();

      expect(output).toContain("Unknown");
    });
  });

  describe("showActionHelp", () => {
    it("should show escrows create with required flags", () => {
      showActionHelp("escrows", "create");
      const output = getOutput();

      expect(output).toContain("create");
      expect(output).toContain("--content-hash");
      expect(output).toContain("--price");
      expect(output).toContain("--yes");
    });

    it("should show escrows fund with flags", () => {
      showActionHelp("escrows", "fund");
      const output = getOutput();

      expect(output).toContain("fund");
      expect(output).toContain("<id>");
      expect(output).toContain("--yes");
    });

    it("should show escrows commit-key with auto-fetch note", () => {
      showActionHelp("escrows", "commit-key");
      const output = getOutput();

      expect(output).toContain("commit-key");
      expect(output).toContain("<id>");
      // Should mention automatic key retrieval
      expect(output.toLowerCase()).toContain("keychain");
    });

    it("should show skills vote with direction", () => {
      showActionHelp("skills", "vote");
      const output = getOutput();

      expect(output).toContain("vote");
      expect(output).toContain("<id>");
      expect(output).toContain("up");
      expect(output).toContain("down");
    });

    it("should show list action with common filters", () => {
      showActionHelp("skills", "list");
      const output = getOutput();

      expect(output).toContain("list");
      expect(output).toContain("--limit");
      expect(output).toContain("--offset");
    });

    it("should indicate unknown action", () => {
      showActionHelp("escrows", "unknown");
      const output = getOutput();

      expect(output).toContain("Unknown");
    });

    it("should show examples where relevant", () => {
      showActionHelp("escrows", "create");
      const output = getOutput();

      // Should have an example section or usage
      expect(output).toContain("ade escrows create");
    });
  });
});
