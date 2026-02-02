/**
 * Integration tests for chain view functions.
 * These tests hit real RPC endpoints but don't require funds.
 *
 * Run with: bun test tests/chain-view.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { DataEscrowABI } from "../src/abi/DataEscrow";
import { CHAINS, CHAIN_BY_ID, getChainConfig } from "../src/addresses";

// Public RPC endpoints (no API key needed)
const BASE_RPC = "https://mainnet.base.org";
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

describe("chain view functions", () => {
  describe("Base Mainnet", () => {
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC),
    });
    const chainConfig = CHAINS.base;

    it("should connect and detect correct chain ID", async () => {
      const chainId = await client.getChainId();
      expect(chainId).toBe(8453);
    });

    it("should have escrow contract deployed at expected address", async () => {
      const code = await client.getCode({ address: chainConfig.escrowAddress });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2); // More than just "0x"
    });

    it("should read nextEscrowId from contract", async () => {
      const nextId = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "nextEscrowId",
      });
      expect(typeof nextId).toBe("bigint");
      expect(nextId).toBeGreaterThan(0n);
    });

    it("should read VERSION from contract", async () => {
      const version = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "VERSION",
      });
      expect(typeof version).toBe("bigint");
      expect(version).toBeGreaterThanOrEqual(3n); // V3 contract
    });

    it("should read DEFAULT_DISPUTE_WINDOW from contract", async () => {
      const window = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "DEFAULT_DISPUTE_WINDOW",
      });
      expect(typeof window).toBe("bigint");
      expect(window).toBeGreaterThan(0n);
    });

    it("should read feeBasisPoints from contract", async () => {
      const feeBps = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "feeBasisPoints",
      });
      expect(typeof feeBps).toBe("bigint");
      // Fee should be reasonable (0-1000 bps = 0-10%)
      expect(feeBps).toBeLessThanOrEqual(1000n);
    });

    it("should read existing escrow data", async () => {
      // Read nextEscrowId to find a valid escrow
      const nextId = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "nextEscrowId",
      }) as bigint;

      if (nextId > 1n) {
        // Read escrow #1 (should exist on mainnet)
        const escrow = await client.readContract({
          address: chainConfig.escrowAddress,
          abi: DataEscrowABI,
          functionName: "getEscrow",
          args: [1n],
        });

        expect(escrow).toBeDefined();
        // getEscrow returns a tuple with seller, buyer, paymentToken, etc.
        expect(Array.isArray(escrow)).toBe(true);
      }
    });

    it("should read treasury address", async () => {
      const treasury = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "treasury",
      });
      expect(treasury).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("should read owner address", async () => {
      const owner = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "owner",
      });
      expect(owner).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("should check if native token (ETH) is supported", async () => {
      const nativeToken = "0x0000000000000000000000000000000000000000";
      const isSupported = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "isTokenSupported",
        args: [nativeToken],
      });
      expect(isSupported).toBe(true);
    });

    it("should return false for unsupported random token", async () => {
      const randomToken = "0x1234567890123456789012345678901234567890";
      const isSupported = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "isTokenSupported",
        args: [randomToken],
      });
      expect(isSupported).toBe(false);
    });

    it("should read contract pause status", async () => {
      const isPaused = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "paused",
      });
      expect(typeof isPaused).toBe("boolean");
      // Contract should not be paused in normal operation
      expect(isPaused).toBe(false);
    });
  });

  describe("Base Sepolia (Testnet)", () => {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(BASE_SEPOLIA_RPC),
    });
    const chainConfig = CHAINS.baseSepolia;

    it("should connect and detect correct chain ID", async () => {
      const chainId = await client.getChainId();
      expect(chainId).toBe(84532);
    });

    it("should have escrow contract deployed at expected address", async () => {
      const code = await client.getCode({ address: chainConfig.escrowAddress });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });

    it("should read nextEscrowId from contract", async () => {
      const nextId = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "nextEscrowId",
      });
      expect(typeof nextId).toBe("bigint");
      // Testnet may have fewer escrows, but ID should be >= 1
      expect(nextId).toBeGreaterThanOrEqual(1n);
    });

    it("should read VERSION from contract", async () => {
      const version = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "VERSION",
      });
      expect(typeof version).toBe("bigint");
      expect(version).toBeGreaterThanOrEqual(3n);
    });

    it("should check native token support", async () => {
      const nativeToken = "0x0000000000000000000000000000000000000000";
      const isSupported = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "isTokenSupported",
        args: [nativeToken],
      });
      expect(isSupported).toBe(true);
    });
  });

  describe("Chain config consistency", () => {
    it("should have matching chainId in config and on-chain", async () => {
      // Base mainnet
      const baseClient = createPublicClient({
        chain: base,
        transport: http(BASE_RPC),
      });
      const baseChainId = await baseClient.getChainId();
      expect(baseChainId).toBe(CHAINS.base.chainId);

      // Base Sepolia
      const sepoliaClient = createPublicClient({
        chain: baseSepolia,
        transport: http(BASE_SEPOLIA_RPC),
      });
      const sepoliaChainId = await sepoliaClient.getChainId();
      expect(sepoliaChainId).toBe(CHAINS.baseSepolia.chainId);
    });

    it("should have CHAIN_BY_ID mapping match CHAINS", () => {
      expect(CHAIN_BY_ID[8453]).toBe(CHAINS.base);
      expect(CHAIN_BY_ID[84532]).toBe(CHAINS.baseSepolia);
    });

    it("should return correct config from getChainConfig", () => {
      expect(getChainConfig(8453)).toBe(CHAINS.base);
      expect(getChainConfig(84532)).toBe(CHAINS.baseSepolia);
      expect(getChainConfig("base")).toBe(CHAINS.base);
      expect(getChainConfig("baseSepolia")).toBe(CHAINS.baseSepolia);
    });
  });

  describe("Contract constants", () => {
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC),
    });
    const chainConfig = CHAINS.base;

    it("should read MIN_BLOCK_DELAY", async () => {
      const minBlockDelay = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "MIN_BLOCK_DELAY",
      });
      expect(typeof minBlockDelay).toBe("bigint");
      expect(minBlockDelay).toBeGreaterThanOrEqual(2n); // At least 2 blocks
    });

    it("should read MIN_TIME_DELAY", async () => {
      const minTimeDelay = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "MIN_TIME_DELAY",
      });
      expect(typeof minTimeDelay).toBe("bigint");
      expect(minTimeDelay).toBeGreaterThanOrEqual(60n); // At least 60 seconds
    });

    it("should read DISPUTE_BOND_PERCENT", async () => {
      const bondPercent = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "DISPUTE_BOND_PERCENT",
      });
      expect(typeof bondPercent).toBe("bigint");
      expect(bondPercent).toBe(5n); // 5% bond
    });

    it("should read MAX_DISPUTE_WINDOW", async () => {
      const maxWindow = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "MAX_DISPUTE_WINDOW",
      });
      expect(typeof maxWindow).toBe("bigint");
      expect(maxWindow).toBeGreaterThan(0n);
    });

    it("should read MIN_AMOUNT_NATIVE", async () => {
      const minAmount = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "MIN_AMOUNT_NATIVE",
      });
      expect(typeof minAmount).toBe("bigint");
      expect(minAmount).toBeGreaterThan(0n);
    });

    it("should read SELLER_RESPONSE_WINDOW", async () => {
      const window = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "SELLER_RESPONSE_WINDOW",
      });
      expect(typeof window).toBe("bigint");
      expect(window).toBeGreaterThan(0n);
    });
  });

  describe("Escrow data reading", () => {
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC),
    });
    const chainConfig = CHAINS.base;

    it("should read escrow via getEscrow function", async () => {
      // First check if there are any escrows
      const nextId = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "nextEscrowId",
      }) as bigint;

      if (nextId > 1n) {
        const escrow = await client.readContract({
          address: chainConfig.escrowAddress,
          abi: DataEscrowABI,
          functionName: "getEscrow",
          args: [1n],
        }) as readonly [
          `0x${string}`, // seller
          `0x${string}`, // buyer
          `0x${string}`, // paymentToken
          `0x${string}`, // contentHash
          `0x${string}`, // keyCommitment
          bigint,        // amount
          bigint,        // expiresAt
          bigint,        // disputeWindow
          number,        // state
        ];

        const [seller, buyer, paymentToken, contentHash, keyCommitment, amount, expiresAt, disputeWindow, state] = escrow;

        // Verify structure
        expect(seller).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(paymentToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(contentHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(typeof amount).toBe("bigint");
        expect(typeof expiresAt).toBe("bigint");
        expect(typeof state).toBe("number");
        expect(state).toBeGreaterThanOrEqual(0);
        expect(state).toBeLessThanOrEqual(7); // Valid state range
      }
    });

    it("should read escrow agents", async () => {
      const nextId = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "nextEscrowId",
      }) as bigint;

      if (nextId > 1n) {
        const agents = await client.readContract({
          address: chainConfig.escrowAddress,
          abi: DataEscrowABI,
          functionName: "getEscrowAgents",
          args: [1n],
        }) as readonly [bigint, bigint];

        const [sellerAgentId, buyerAgentId] = agents;
        expect(typeof sellerAgentId).toBe("bigint");
        expect(typeof buyerAgentId).toBe("bigint");
      }
    });

    it("should handle non-existent escrow gracefully", async () => {
      // Try to read a very high escrow ID that doesn't exist
      const escrow = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "getEscrow",
        args: [999999999n],
      }) as readonly unknown[];

      // Contract returns empty/zero values for non-existent escrows
      expect(escrow).toBeDefined();
      // Seller should be zero address
      expect(escrow[0]).toBe("0x0000000000000000000000000000000000000000");
    });
  });

  describe("Arbiters", () => {
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC),
    });
    const chainConfig = CHAINS.base;

    it("should read arbiters list", async () => {
      const arbiters = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "getArbiters",
      }) as readonly `0x${string}`[];

      expect(Array.isArray(arbiters)).toBe(true);
      // Should have at least one arbiter
      expect(arbiters.length).toBeGreaterThan(0);

      // Each arbiter should be a valid address
      for (const arbiter of arbiters) {
        expect(arbiter).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    });

    it("should read requiredVotes", async () => {
      const requiredVotes = await client.readContract({
        address: chainConfig.escrowAddress,
        abi: DataEscrowABI,
        functionName: "requiredVotes",
      });
      expect(typeof requiredVotes).toBe("bigint");
      expect(requiredVotes).toBeGreaterThan(0n);
    });
  });
});
