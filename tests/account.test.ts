import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as mockKeychain from "./keychain/mock";
import {
  accountCreate,
  accountUnlock,
  accountLock,
  accountStatus,
  accountList,
  accountExport,
  accountDelete,
} from "../src/commands";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("account commands", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockKeychain.clear();

    // Mock ENS API calls
    mockFetch = mock((url: string, opts?: RequestInit) => {
      // GET /api/ens/lookup/{username} - check availability
      if (url.includes("/api/ens/lookup/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ exists: false }), { status: 200 })
        );
      }
      // POST /api/ens/register - register subdomain
      if (url.includes("/api/ens/register") && opts?.method === "POST") {
        const body = JSON.parse(opts.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              ensName: `${body.username}.fairdata.eth`,
              txHash: "0x" + "a".repeat(64),
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    // Ensure account is locked after each test
    await accountLock(mockKeychain);
  });

  describe("accountCreate", () => {
    it("should create a new account with ENS registration", async () => {
      const result = await accountCreate("alice", "testpassword123", mockKeychain);

      expect(result.subdomain).toBe("alice");
      expect(result.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(result.publicKey).toMatch(/^0x[0-9a-f]{66}$/);
      expect(result.ensName).toBe("alice.fairdata.eth");
      expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should store keystore in keychain", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);

      const keystore = await mockKeychain.get("FAIRDROP_KEYSTORE_alice");
      expect(keystore).toBeTruthy();
      expect(JSON.parse(keystore!).type).toBe("fairdrop");
    });

    it("should store ENS info in keychain", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);

      const ensName = await mockKeychain.get("FAIRDROP_ENS_alice");
      const txHash = await mockKeychain.get("FAIRDROP_TXHASH_alice");
      expect(ensName).toBe("alice.fairdata.eth");
      expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should reject duplicate subdomain locally", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);

      await expect(
        accountCreate("alice", "testpassword456", mockKeychain)
      ).rejects.toThrow(/already exists/);
    });

    it("should reject if name taken on ENS", async () => {
      // Mock ENS lookup to return exists: true
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/api/ens/lookup/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ exists: true, owner: "0x1234", publicKey: "0x5678" }),
              { status: 200 }
            )
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });

      await expect(
        accountCreate("taken", "testpassword123", mockKeychain)
      ).rejects.toThrow(/already registered on ENS/);
    });

    it("should reject empty subdomain", async () => {
      await expect(
        accountCreate("", "testpassword123", mockKeychain)
      ).rejects.toThrow(/cannot be empty/);
    });

    it("should reject invalid subdomain characters", async () => {
      await expect(
        accountCreate("alice@bob", "testpassword123", mockKeychain)
      ).rejects.toThrow(/can only contain/);
    });

    it("should reject short password", async () => {
      await expect(
        accountCreate("alice", "short", mockKeychain)
      ).rejects.toThrow(/at least 8 characters/);
    });
  });

  describe("accountUnlock", () => {
    beforeEach(async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
    });

    it("should unlock an existing account", async () => {
      const result = await accountUnlock("alice", "testpassword123", mockKeychain);

      expect(result.unlocked).toBe(true);
      expect(result.subdomain).toBe("alice");
      expect(result.address).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should reject wrong password", async () => {
      await expect(
        accountUnlock("alice", "wrongpassword", mockKeychain)
      ).rejects.toThrow(/Incorrect password/);
    });

    it("should reject non-existent account", async () => {
      await expect(
        accountUnlock("nonexistent", "testpassword123", mockKeychain)
      ).rejects.toThrow(/not found/);
    });
  });

  describe("accountLock", () => {
    it("should lock an unlocked account", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
      await accountUnlock("alice", "testpassword123", mockKeychain);

      const result = await accountLock(mockKeychain);

      expect(result.locked).toBe(true);
      expect(result.previousAccount).toBe("alice");
    });

    it("should succeed even if no account is unlocked", async () => {
      const result = await accountLock(mockKeychain);

      expect(result.locked).toBe(true);
      expect(result.previousAccount).toBeUndefined();
    });
  });

  describe("accountStatus", () => {
    it("should return inactive when no accounts exist", async () => {
      const result = await accountStatus(undefined, mockKeychain);

      expect(result.active).toBe(false);
      expect(result.subdomain).toBeUndefined();
    });

    it("should show public info without unlock", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
      // NOT unlocking - should still see public info

      const result = await accountStatus("alice", mockKeychain);

      expect(result.active).toBe(false); // Not unlocked
      expect(result.subdomain).toBe("alice");
      expect(result.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(result.publicKey).toMatch(/^0x[0-9a-f]{66}$/);
      expect(result.ensName).toBe("alice.fairdata.eth");
      expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should show active=true when account is unlocked", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
      await accountUnlock("alice", "testpassword123", mockKeychain);

      const result = await accountStatus("alice", mockKeychain);

      expect(result.active).toBe(true);
      expect(result.subdomain).toBe("alice");
    });

    it("should default to first account when no subdomain specified", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);

      const result = await accountStatus(undefined, mockKeychain);

      expect(result.subdomain).toBe("alice");
    });
  });

  describe("accountList", () => {
    it("should return empty list when no accounts", async () => {
      const result = await accountList(mockKeychain);

      expect(result.accounts).toEqual([]);
    });

    it("should list all accounts", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
      await accountCreate("bob", "testpassword456", mockKeychain);

      const result = await accountList(mockKeychain);

      expect(result.accounts).toHaveLength(2);
      expect(result.accounts.map((a) => a.subdomain).sort()).toEqual(["alice", "bob"]);
    });

    it("should mark active account", async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
      await accountCreate("bob", "testpassword456", mockKeychain);
      await accountUnlock("alice", "testpassword123", mockKeychain);

      const result = await accountList(mockKeychain);

      const alice = result.accounts.find((a) => a.subdomain === "alice");
      const bob = result.accounts.find((a) => a.subdomain === "bob");
      expect(alice?.active).toBe(true);
      expect(bob?.active).toBe(false);
    });
  });

  describe("accountExport", () => {
    beforeEach(async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
    });

    it("should export keystore JSON", async () => {
      const result = await accountExport("alice", mockKeychain);

      expect(result.subdomain).toBe("alice");
      expect(result.keystore).toBeTruthy();

      const keystore = JSON.parse(result.keystore);
      expect(keystore.type).toBe("fairdrop");
      expect(keystore.version).toBe(1);
    });

    it("should reject non-existent account", async () => {
      await expect(accountExport("nonexistent", mockKeychain)).rejects.toThrow(
        /not found/
      );
    });
  });

  describe("accountDelete", () => {
    beforeEach(async () => {
      await accountCreate("alice", "testpassword123", mockKeychain);
    });

    it("should delete an account", async () => {
      const result = await accountDelete("alice", true, mockKeychain);

      expect(result.deleted).toBe(true);
      expect(result.subdomain).toBe("alice");

      // Verify keystore is deleted
      const keystore = await mockKeychain.get("FAIRDROP_KEYSTORE_alice");
      expect(keystore).toBeNull();
    });

    it("should require confirmation", async () => {
      await expect(accountDelete("alice", false, mockKeychain)).rejects.toThrow(
        /confirm/i
      );
    });

    it("should reject non-existent account", async () => {
      await expect(
        accountDelete("nonexistent", true, mockKeychain)
      ).rejects.toThrow(/not found/);
    });

    it("should lock active account when deleted", async () => {
      await accountUnlock("alice", "testpassword123", mockKeychain);
      expect((await accountStatus("alice", mockKeychain)).active).toBe(true);

      await accountDelete("alice", true, mockKeychain);

      // Account no longer exists, so status should return inactive
      const result = await accountStatus(undefined, mockKeychain);
      expect(result.active).toBe(false);
    });
  });
});
