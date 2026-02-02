/**
 * Contract addresses for supported chains.
 */

import { getAddress } from 'viem'

export interface ChainConfig {
  chainId: number
  name: string
  escrowAddress: `0x${string}`
  explorer: string
  defaultRpc: string
}

// Checksummed addresses with default public RPCs
export const CHAINS: Record<string, ChainConfig> = {
  base: {
    chainId: 8453,
    name: 'Base',
    escrowAddress: getAddress('0xDd4396d4F28d2b513175ae17dE11e56a898d19c3'),
    explorer: 'https://basescan.org',
    defaultRpc: 'https://mainnet.base.org',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    escrowAddress: getAddress('0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6'),
    explorer: 'https://sepolia.basescan.org',
    defaultRpc: 'https://sepolia.base.org',
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
