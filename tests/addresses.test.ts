import { describe, it, expect } from "bun:test";
import { CHAINS, CHAIN_BY_ID, getChainConfig, getSupportedChains, DEFAULT_RPC } from "../src/addresses";

describe("addresses", () => {
  describe("CHAINS", () => {
    it("should have base mainnet config", () => {
      expect(CHAINS.base).toBeDefined();
      expect(CHAINS.base.chainId).toBe(8453);
      expect(CHAINS.base.name).toBe("Base");
      expect(CHAINS.base.contracts.dataEscrow).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.contracts.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.contracts.usdt).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.explorer).toContain("basescan.org");
    });

    it("should have base sepolia config", () => {
      expect(CHAINS.baseSepolia).toBeDefined();
      expect(CHAINS.baseSepolia.chainId).toBe(84532);
      expect(CHAINS.baseSepolia.name).toBe("Base Sepolia");
      expect(CHAINS.baseSepolia.contracts.dataEscrow).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.contracts.identity).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.contracts.reputation).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.contracts.validation).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.contracts.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.explorer).toContain("sepolia.basescan.org");
    });

    it("should have checksummed addresses", () => {
      // Checksummed addresses have mixed case
      expect(CHAINS.base.contracts.dataEscrow).not.toBe(CHAINS.base.contracts.dataEscrow.toLowerCase());
      expect(CHAINS.baseSepolia.contracts.dataEscrow).not.toBe(CHAINS.baseSepolia.contracts.dataEscrow.toLowerCase());
    });

    it("should have default RPC endpoints", () => {
      expect(CHAINS.base.defaultRpc).toBe("https://mainnet.base.org");
      expect(CHAINS.baseSepolia.defaultRpc).toBe("https://sepolia.base.org");
    });
  });

  describe("DEFAULT_RPC", () => {
    it("should be Base mainnet RPC", () => {
      expect(DEFAULT_RPC).toBe("https://mainnet.base.org");
      expect(DEFAULT_RPC).toBe(CHAINS.base.defaultRpc);
    });
  });

  describe("CHAIN_BY_ID", () => {
    it("should map chainId to config", () => {
      expect(CHAIN_BY_ID[8453]).toBe(CHAINS.base);
      expect(CHAIN_BY_ID[84532]).toBe(CHAINS.baseSepolia);
    });
  });

  describe("getChainConfig", () => {
    it("should get config by name", () => {
      expect(getChainConfig("base")).toBe(CHAINS.base);
      expect(getChainConfig("baseSepolia")).toBe(CHAINS.baseSepolia);
    });

    it("should get config by chainId", () => {
      expect(getChainConfig(8453)).toBe(CHAINS.base);
      expect(getChainConfig(84532)).toBe(CHAINS.baseSepolia);
    });

    it("should throw for unknown chain name", () => {
      expect(() => getChainConfig("ethereum")).toThrow("Unknown chain");
    });

    it("should throw for unsupported chainId", () => {
      expect(() => getChainConfig(1)).toThrow("Unsupported chain ID");
    });
  });

  describe("getSupportedChains", () => {
    it("should return list of supported chain names", () => {
      const chains = getSupportedChains();
      expect(chains).toContain("base");
      expect(chains).toContain("baseSepolia");
    });
  });
});
