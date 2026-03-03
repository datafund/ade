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
    dataEscrow?: `0x${string}`
    // ERC-8004 contracts (official 0x8004 prefix addresses)
    identity?: `0x${string}`
    reputation?: `0x${string}`
    validation?: `0x${string}`
    // Tokens
    usdc?: `0x${string}`
    usdt?: `0x${string}`
  }
}

// Official ERC-8004 contract addresses (deterministic deployment with 0x8004 prefix)
const ERC8004_MAINNET = {
  identity: getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
  reputation: getAddress('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'),
}

const ERC8004_TESTNET = {
  identity: getAddress('0x8004A818BFB912233c491871b3d84c89A494BD9e'),
  reputation: getAddress('0x8004B663056A597Dffe9eCcC1965A193B7388713'),
}

// Checksummed addresses with default public RPCs
export const CHAINS: Record<string, ChainConfig> = {
  // ── Mainnets ──
  base: {
    chainId: 8453,
    name: 'Base',
    explorer: 'https://basescan.org',
    defaultRpc: 'https://mainnet.base.org',
    contracts: {
      dataEscrow: getAddress('0x69Aa385686AEdA505013a775ddE7A59d045cb30d'),
      ...ERC8004_MAINNET,
      usdc: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
      usdt: getAddress('0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'),
    },
  },
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    explorer: 'https://etherscan.io',
    defaultRpc: 'https://eth.llamarpc.com',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_MAINNET,
      usdc: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      usdt: getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    },
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    explorer: 'https://polygonscan.com',
    defaultRpc: 'https://polygon-rpc.com',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_MAINNET,
      usdc: getAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
      usdt: getAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    },
  },
  bsc: {
    chainId: 56,
    name: 'BNB Chain',
    explorer: 'https://bscscan.com',
    defaultRpc: 'https://bsc-dataseed.binance.org',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_MAINNET,
      usdc: getAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
      usdt: getAddress('0x55d398326f99059fF775485246999027B3197955'),
    },
  },

  // ── Testnets ──
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    explorer: 'https://sepolia.basescan.org',
    defaultRpc: 'https://sepolia.base.org',
    contracts: {
      dataEscrow: getAddress('0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6'),
      ...ERC8004_TESTNET,
      usdc: getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    },
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    explorer: 'https://sepolia.etherscan.io',
    defaultRpc: 'https://rpc.sepolia.org',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_TESTNET,
    },
  },
  polygonAmoy: {
    chainId: 80002,
    name: 'Polygon Amoy',
    explorer: 'https://amoy.polygonscan.com',
    defaultRpc: 'https://rpc-amoy.polygon.technology',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_TESTNET,
    },
  },
  bscTestnet: {
    chainId: 97,
    name: 'BNB Testnet',
    explorer: 'https://testnet.bscscan.com',
    defaultRpc: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    contracts: {
      dataEscrow: undefined, // Not deployed
      ...ERC8004_TESTNET,
    },
  },
}

// Default RPC for mainnet
export const DEFAULT_RPC = CHAINS.base.defaultRpc

// Map chainId to config
export const CHAIN_BY_ID: Record<number, ChainConfig> = {
  // Mainnets
  [CHAINS.base.chainId]: CHAINS.base,
  [CHAINS.ethereum.chainId]: CHAINS.ethereum,
  [CHAINS.polygon.chainId]: CHAINS.polygon,
  [CHAINS.bsc.chainId]: CHAINS.bsc,
  // Testnets
  [CHAINS.baseSepolia.chainId]: CHAINS.baseSepolia,
  [CHAINS.sepolia.chainId]: CHAINS.sepolia,
  [CHAINS.polygonAmoy.chainId]: CHAINS.polygonAmoy,
  [CHAINS.bscTestnet.chainId]: CHAINS.bscTestnet,
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
