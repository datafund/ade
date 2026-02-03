import { describe, it, expect } from "bun:test";
import { CHAINS, CHAIN_BY_ID, getChainConfig, getSupportedChains, DEFAULT_RPC } from "../src/addresses";

describe("addresses", () => {
  describe("CHAINS", () => {
    it("should have base mainnet config", () => {
      expect(CHAINS.base).toBeDefined();
      expect(CHAINS.base.chainId).toBe(8453);
      expect(CHAINS.base.name).toBe("Base");
      expect(CHAINS.base.contracts.dataEscrow).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.contracts.identity).toMatch(/^0x8004/); // Official ERC-8004
      expect(CHAINS.base.contracts.reputation).toMatch(/^0x8004/);
      expect(CHAINS.base.contracts.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.contracts.usdt).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.base.explorer).toContain("basescan.org");
    });

    it("should have base sepolia config", () => {
      expect(CHAINS.baseSepolia).toBeDefined();
      expect(CHAINS.baseSepolia.chainId).toBe(84532);
      expect(CHAINS.baseSepolia.name).toBe("Base Sepolia");
      expect(CHAINS.baseSepolia.contracts.dataEscrow).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.contracts.identity).toMatch(/^0x8004/); // Official ERC-8004
      expect(CHAINS.baseSepolia.contracts.reputation).toMatch(/^0x8004/);
      expect(CHAINS.baseSepolia.contracts.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(CHAINS.baseSepolia.explorer).toContain("sepolia.basescan.org");
    });

    it("should have ethereum mainnet config with ERC-8004", () => {
      expect(CHAINS.ethereum).toBeDefined();
      expect(CHAINS.ethereum.chainId).toBe(1);
      expect(CHAINS.ethereum.contracts.identity).toMatch(/^0x8004/);
      expect(CHAINS.ethereum.contracts.reputation).toMatch(/^0x8004/);
      expect(CHAINS.ethereum.contracts.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("should have polygon mainnet config with ERC-8004", () => {
      expect(CHAINS.polygon).toBeDefined();
      expect(CHAINS.polygon.chainId).toBe(137);
      expect(CHAINS.polygon.contracts.identity).toMatch(/^0x8004/);
      expect(CHAINS.polygon.contracts.reputation).toMatch(/^0x8004/);
    });

    it("should have checksummed addresses", () => {
      // Checksummed addresses have mixed case
      expect(CHAINS.base.contracts.dataEscrow).not.toBe(CHAINS.base.contracts.dataEscrow!.toLowerCase());
      expect(CHAINS.baseSepolia.contracts.dataEscrow).not.toBe(CHAINS.baseSepolia.contracts.dataEscrow!.toLowerCase());
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
      expect(CHAIN_BY_ID[1]).toBe(CHAINS.ethereum);
      expect(CHAIN_BY_ID[137]).toBe(CHAINS.polygon);
      expect(CHAIN_BY_ID[56]).toBe(CHAINS.bsc);
      expect(CHAIN_BY_ID[11155111]).toBe(CHAINS.sepolia);
    });
  });

  describe("getChainConfig", () => {
    it("should get config by name", () => {
      expect(getChainConfig("base")).toBe(CHAINS.base);
      expect(getChainConfig("baseSepolia")).toBe(CHAINS.baseSepolia);
      expect(getChainConfig("ethereum")).toBe(CHAINS.ethereum);
    });

    it("should get config by chainId", () => {
      expect(getChainConfig(8453)).toBe(CHAINS.base);
      expect(getChainConfig(84532)).toBe(CHAINS.baseSepolia);
      expect(getChainConfig(1)).toBe(CHAINS.ethereum);
    });

    it("should throw for unknown chain name", () => {
      expect(() => getChainConfig("unknown")).toThrow("Unknown chain");
    });

    it("should throw for unsupported chainId", () => {
      expect(() => getChainConfig(999999)).toThrow("Unsupported chain ID");
    });
  });

  describe("getSupportedChains", () => {
    it("should return list of supported chain names", () => {
      const chains = getSupportedChains();
      expect(chains).toContain("base");
      expect(chains).toContain("baseSepolia");
      expect(chains).toContain("ethereum");
      expect(chains).toContain("polygon");
      expect(chains).toContain("bsc");
      expect(chains).toContain("sepolia");
    });
  });
});
