import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmdirSync } from "fs";

describe("watch-state", () => {
  let watchState: typeof import("../src/watch-state");

  const CONFIG_DIR = join(homedir(), ".config", "ade");
  const STATE_PATH = join(CONFIG_DIR, "watch-state.json");
  const LOCK_DIR = join(CONFIG_DIR, "watch.lock");
  const PID_PATH = join(LOCK_DIR, "pid");

  // Use a test SX_KEY for HMAC derivation
  const TEST_SX_KEY =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  beforeEach(async () => {
    watchState = await import("../src/watch-state");
    // Clean up any existing state/lock from previous test runs
    try {
      unlinkSync(STATE_PATH);
    } catch {}
    try {
      unlinkSync(STATE_PATH + ".tmp");
    } catch {}
    try {
      unlinkSync(PID_PATH);
    } catch {}
    try {
      rmdirSync(LOCK_DIR);
    } catch {}
  });

  afterEach(() => {
    try {
      unlinkSync(STATE_PATH);
    } catch {}
    try {
      unlinkSync(PID_PATH);
    } catch {}
    try {
      rmdirSync(LOCK_DIR);
    } catch {}
  });

  describe("state persistence", () => {
    it("should save and load state with valid HMAC", () => {
      const state = {
        version: 1 as const,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastCycle: new Date().toISOString(),
        cycleCount: 5,
        dailyDate: new Date().toISOString().slice(0, 10),
        dailyValueProcessed: "0.5",
        dailyTxCount: 3,
        cumulativeValueProcessed: "1.5",
        handled: {},
      };

      watchState.saveWatchState(state, TEST_SX_KEY);
      const loaded = watchState.loadWatchState(TEST_SX_KEY);

      expect(loaded.version).toBe(1);
      expect(loaded.cycleCount).toBe(5);
      expect(loaded.dailyValueProcessed).toBe("0.5");
      expect(loaded.cumulativeValueProcessed).toBe("1.5");
      expect(loaded.hmac).toBeDefined();
    });

    it("should detect tampering via HMAC mismatch", () => {
      const state = {
        version: 1 as const,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastCycle: new Date().toISOString(),
        cycleCount: 1,
        dailyDate: new Date().toISOString().slice(0, 10),
        dailyValueProcessed: "0",
        dailyTxCount: 0,
        cumulativeValueProcessed: "0",
        handled: {},
      };

      watchState.saveWatchState(state, TEST_SX_KEY);

      // Tamper with the file
      const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
      raw.cycleCount = 999;
      writeFileSync(STATE_PATH, JSON.stringify(raw, null, 2));

      expect(() => watchState.loadWatchState(TEST_SX_KEY)).toThrow(
        /tampered|corrupted/i
      );
    });

    it("should detect wrong key via HMAC mismatch", () => {
      const state = {
        version: 1 as const,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastCycle: new Date().toISOString(),
        cycleCount: 1,
        dailyDate: new Date().toISOString().slice(0, 10),
        dailyValueProcessed: "0",
        dailyTxCount: 0,
        cumulativeValueProcessed: "0",
        handled: {},
      };

      watchState.saveWatchState(state, TEST_SX_KEY);

      const wrongKey =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      expect(() => watchState.loadWatchState(wrongKey)).toThrow(
        /tampered|corrupted/i
      );
    });

    it("should reject oversized state file", () => {
      mkdirSync(CONFIG_DIR, { recursive: true });
      // Write a file larger than 100KB
      const largeData = JSON.stringify({
        hmac: "0x" + "a".repeat(64),
        version: 1,
        handled: { data: "x".repeat(110000) },
      });
      writeFileSync(STATE_PATH, largeData);

      expect(() => watchState.loadWatchState(TEST_SX_KEY)).toThrow(
        /too large/i
      );
    });
  });

  describe("lock management", () => {
    it("should acquire and release lock", () => {
      watchState.acquireLock();
      expect(existsSync(LOCK_DIR)).toBe(true);
      expect(existsSync(PID_PATH)).toBe(true);

      const pidStr = readFileSync(PID_PATH, "utf-8").trim();
      expect(parseInt(pidStr, 10)).toBe(process.pid);

      watchState.releaseLock();
      expect(existsSync(PID_PATH)).toBe(false);
      expect(existsSync(LOCK_DIR)).toBe(false);
    });

    it("should detect stale lock and recover", () => {
      // Create a lock with a dead PID
      mkdirSync(LOCK_DIR, { recursive: true });
      writeFileSync(PID_PATH, "99999999"); // Likely dead PID

      // Should succeed by cleaning up stale lock
      watchState.acquireLock();
      expect(existsSync(LOCK_DIR)).toBe(true);

      const pidStr = readFileSync(PID_PATH, "utf-8").trim();
      expect(parseInt(pidStr, 10)).toBe(process.pid);

      watchState.releaseLock();
    });
  });
});

describe("watch command", () => {
  describe("validation", () => {
    let watchModule: typeof import("../src/watch");

    beforeEach(async () => {
      watchModule = await import("../src/watch");
    });

    it("should export watch, watchStatus, watchResetState functions", () => {
      expect(typeof watchModule.watch).toBe("function");
      expect(typeof watchModule.watchStatus).toBe("function");
      expect(typeof watchModule.watchResetState).toBe("function");
    });
  });
});
