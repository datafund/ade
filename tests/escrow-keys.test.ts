import { describe, it, expect, beforeEach } from "bun:test";
import { storeEscrowKeys, getEscrowKeys, deleteEscrowKeys, listEscrowIds, type EscrowKeys } from "../src/escrow-keys";
import * as mock from "./keychain/mock";

describe("escrow-keys", () => {
  beforeEach(() => {
    mock.clear();
  });

  describe("storeEscrowKeys", () => {
    it("should store key and salt with escrow ID prefix", async () => {
      const keys: EscrowKeys = {
        encryptionKey: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        salt: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      };

      await storeEscrowKeys(42, keys, mock);

      expect(await mock.get("ESCROW_42_KEY")).toBe(keys.encryptionKey);
      expect(await mock.get("ESCROW_42_SALT")).toBe(keys.salt);
    });

    it("should overwrite existing keys for same escrow ID", async () => {
      await storeEscrowKeys(1, { encryptionKey: "0xold", salt: "0xoldsalt" }, mock);
      await storeEscrowKeys(1, { encryptionKey: "0xnew", salt: "0xnewsalt" }, mock);

      expect(await mock.get("ESCROW_1_KEY")).toBe("0xnew");
      expect(await mock.get("ESCROW_1_SALT")).toBe("0xnewsalt");
    });
  });

  describe("getEscrowKeys", () => {
    it("should retrieve stored keys", async () => {
      await mock.set("ESCROW_5_KEY", "0xmykey");
      await mock.set("ESCROW_5_SALT", "0xmysalt");

      const result = await getEscrowKeys(5, mock);

      expect(result).toEqual({
        encryptionKey: "0xmykey",
        salt: "0xmysalt",
      });
    });

    it("should return null when key not found", async () => {
      const result = await getEscrowKeys(999, mock);
      expect(result).toBeNull();
    });

    it("should return null when only key exists but no salt", async () => {
      await mock.set("ESCROW_10_KEY", "0xkey");
      const result = await getEscrowKeys(10, mock);
      expect(result).toBeNull();
    });

    it("should return null when only salt exists but no key", async () => {
      await mock.set("ESCROW_10_SALT", "0xsalt");
      const result = await getEscrowKeys(10, mock);
      expect(result).toBeNull();
    });
  });

  describe("deleteEscrowKeys", () => {
    it("should remove both key and salt", async () => {
      await mock.set("ESCROW_3_KEY", "0xkey");
      await mock.set("ESCROW_3_SALT", "0xsalt");

      await deleteEscrowKeys(3, mock);

      expect(await mock.get("ESCROW_3_KEY")).toBeNull();
      expect(await mock.get("ESCROW_3_SALT")).toBeNull();
    });

    it("should not throw when keys do not exist", async () => {
      await deleteEscrowKeys(999, mock);
      // Should complete without throwing
    });
  });

  describe("listEscrowIds", () => {
    it("should return empty array when no escrow keys stored", async () => {
      const ids = await listEscrowIds(mock);
      expect(ids).toEqual([]);
    });

    it("should return IDs of stored escrows", async () => {
      await mock.set("ESCROW_1_KEY", "0xkey1");
      await mock.set("ESCROW_1_SALT", "0xsalt1");
      await mock.set("ESCROW_5_KEY", "0xkey5");
      await mock.set("ESCROW_5_SALT", "0xsalt5");
      await mock.set("ESCROW_10_KEY", "0xkey10");
      await mock.set("ESCROW_10_SALT", "0xsalt10");

      const ids = await listEscrowIds(mock);
      expect(ids.sort((a, b) => a - b)).toEqual([1, 5, 10]);
    });

    it("should not include partial escrows (only key, no salt)", async () => {
      await mock.set("ESCROW_1_KEY", "0xkey1");
      await mock.set("ESCROW_1_SALT", "0xsalt1");
      await mock.set("ESCROW_2_KEY", "0xkey2"); // No salt

      const ids = await listEscrowIds(mock);
      expect(ids).toEqual([1]);
    });

    it("should ignore other keychain entries", async () => {
      await mock.set("SX_KEY", "0xprivatekey");
      await mock.set("SX_RPC", "https://rpc.example.com");
      await mock.set("ESCROW_1_KEY", "0xkey1");
      await mock.set("ESCROW_1_SALT", "0xsalt1");

      const ids = await listEscrowIds(mock);
      expect(ids).toEqual([1]);
    });
  });
});
