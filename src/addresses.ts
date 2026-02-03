/**
 * Contract addresses for supported chains.
 */

import { getAddress } from 'viem'

export interface ChainConfig {
  chainId: number
  name: string
  explorer: string
  defaultRpc: string
  contracts: {
    // Core protocol
    dataEscrow: `0x${string}`
    // ERC-8004 contracts
    identity?: `0x${string}`
    reputation?: `0x${string}`
    validation?: `0x${string}`
    // Tokens
    usdc?: `0x${string}`
    usdt?: `0x${string}`
  }
}

// Checksummed addresses with default public RPCs
export const CHAINS: Record<string, ChainConfig> = {
  base: {
    chainId: 8453,
    name: 'Base',
    explorer: 'https://basescan.org',
    defaultRpc: 'https://mainnet.base.org',
    contracts: {
      dataEscrow: getAddress('0xDd4396d4F28d2b513175ae17dE11e56a898d19c3'),
      // ERC-8004 contracts (not yet deployed on mainnet)
      identity: undefined,
      reputation: undefined,
      validation: undefined,
      // Tokens
      usdc: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
      usdt: getAddress('0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'),
    },
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    explorer: 'https://sepolia.basescan.org',
    defaultRpc: 'https://sepolia.base.org',
    contracts: {
      dataEscrow: getAddress('0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6'),
      // ERC-8004 contracts
      identity: getAddress('0x7177a6867296406881E20d6647232314736Dd09A'),
      reputation: getAddress('0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322'),
      validation: getAddress('0x662b40A526cb4017d947e71eAF6753BF3eeE66d8'),
      // Tokens
      usdc: getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
      usdt: undefined, // Not available on Sepolia
    },
  },
}

// Default RPC for mainnet
export const DEFAULT_RPC = CHAINS.base.defaultRpc

// Map chainId to config
export const CHAIN_BY_ID: Record<number, ChainConfig> = {
  [CHAINS.base.chainId]: CHAINS.base,
  [CHAINS.baseSepolia.chainId]: CHAINS.baseSepolia,
}

// Default chain
export const DEFAULT_CHAIN = 'base'

/**
 * Get chain config by name or chainId.
 */
export function getChainConfig(chainOrId: string | number): ChainConfig {
  if (typeof chainOrId === 'number') {
    const config = CHAIN_BY_ID[chainOrId]
    if (!config) {
      throw new Error(`Unsupported chain ID: ${chainOrId}. Supported: ${Object.keys(CHAIN_BY_ID).join(', ')}`)
    }
    return config
  }

  const config = CHAINS[chainOrId]
  if (!config) {
    throw new Error(`Unknown chain: ${chainOrId}. Supported: ${Object.keys(CHAINS).join(', ')}`)
  }
  return config
}

/**
 * Get supported chain names.
 */
export function getSupportedChains(): string[] {
  return Object.keys(CHAINS)
}
