import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { rm, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import * as mockKeychain from "./keychain/mock"

const originalFetch = globalThis.fetch

describe("buyX402 command", () => {
  let mockFetch: ReturnType<typeof mock>
  const testDir = join(import.meta.dir, ".test-files-x402-buy")
  const testKey = "0x" + "1".repeat(64)

  beforeEach(async () => {
    mockKeychain.clear()
    mockFetch = mock(() => Promise.resolve(new Response("{}", { status: 200 })))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    delete process.env.SX_KEY
    delete process.env.SX_API

    try {
      await rm(testDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("validation", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
    })

    it("should require SX_KEY", async () => {
      await expect(
        commands.buyX402({ skillId: "test-123", yes: true }, mockKeychain)
      ).rejects.toThrow(/SX_KEY/)
    })

    it("should require --yes flag in non-TTY mode for new purchases", async () => {
      await mockKeychain.set("SX_KEY", testKey)

      await expect(
        commands.buyX402({ skillId: "test-123", yes: false }, mockKeychain)
      ).rejects.toThrow(/--yes/)
    })

    it("should not require --yes for re-download (has txHash)", async () => {
      await mockKeychain.set("SX_KEY", testKey)

      // Mock a successful re-download
      mockFetch.mockImplementation(() => {
        return Promise.resolve(
          new Response(Buffer.from("re-downloaded content"), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          })
        )
      })

      const outputFile = join(testDir, "redownloaded.dat")
      const result = await commands.buyX402(
        { skillId: "test-123", txHash: "0xabc123", output: outputFile },
        mockKeychain
      )

      expect(result.paymentFormatted).toBe("re-download (no charge)")
      expect(result.paymentAmount).toBe("0")
    })
  })

  describe("skill not found (404)", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should throw on skill not found", async () => {
      mockFetch.mockImplementation((url: string) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()
        if (urlStr.includes("/api/v1/skills/")) {
          return Promise.resolve(
            new Response("Not found", { status: 404 })
          )
        }
        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      await expect(
        commands.buyX402({ skillId: "nonexistent", yes: true }, mockKeychain)
      ).rejects.toThrow(/not found/i)
    })
  })

  describe("wrong payment method", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should throw if skill uses escrow instead of x402", async () => {
      mockFetch.mockImplementation((url: string) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()
        if (urlStr.includes("/api/v1/skills/test-escrow") && !urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: "test-escrow",
              title: "Escrow Skill",
              payment_method: "escrow",
              price: "100000",
            }))
          )
        }
        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      await expect(
        commands.buyX402({ skillId: "test-escrow", yes: true }, mockKeychain)
      ).rejects.toThrow(/escrow/)
    })
  })

  describe("no payment requirements in 402", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should throw when 402 response has no payment requirements", async () => {
      let callCount = 0
      mockFetch.mockImplementation((url: string) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()

        // Skill details - x402 type
        if (urlStr.includes("/api/v1/skills/test-empty") && !urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: "test-empty",
              title: "Empty 402 Skill",
              payment_method: "x402",
              price: "100000",
              seller: "0x" + "a".repeat(40),
            }))
          )
        }

        // Download endpoint - 402 but no requirements
        if (urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              x402Version: 2,
              // No paymentRequirements or accepts
            }), { status: 402 })
          )
        }

        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      await expect(
        commands.buyX402({ skillId: "test-empty", yes: true }, mockKeychain)
      ).rejects.toThrow(/no payment requirements/i)
    })
  })

  describe("successful purchase (402 -> sign -> download)", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should complete full purchase flow", async () => {
      const contentData = Buffer.from("purchased file content here")
      const outputFile = join(testDir, "purchased.dat")

      mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()

        // Step 1: Skill details
        if (urlStr.includes("/api/v1/skills/test-skill") && !urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: "test-skill",
              title: "Test x402 Skill",
              payment_method: "x402",
              price: "1000000",
              seller: "0x" + "a".repeat(40),
            }))
          )
        }

        // Step 2 & 5: Download endpoint
        if (urlStr.includes("/download")) {
          const headers = opts?.headers as Record<string, string> | undefined

          // If X-Payment header present -> paid request, return content
          if (headers?.["X-Payment"]) {
            return Promise.resolve(
              new Response(contentData, {
                status: 200,
                headers: {
                  "content-type": "application/octet-stream",
                  "X-Payment-TxHash": "0xtx" + "f".repeat(60),
                },
              })
            )
          }

          // Initial request -> 402 with payment requirements
          return Promise.resolve(
            new Response(JSON.stringify({
              x402Version: 2,
              paymentRequirements: [{
                scheme: "exact",
                network: "eip155:84532",
                maxAmountRequired: "1000000",
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                payTo: "0x" + "b".repeat(40),
                description: "Payment for test skill",
              }],
            }), { status: 402 })
          )
        }

        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      const result = await commands.buyX402(
        { skillId: "test-skill", output: outputFile, yes: true },
        mockKeychain
      )

      expect(result.skillId).toBe("test-skill")
      expect(result.outputFile).toBe(outputFile)
      expect(result.sizeBytes).toBe(contentData.length)
      expect(result.txHash).toMatch(/^0xtx/)
      expect(result.paymentAmount).toBe("1000000")
      expect(result.paymentFormatted).toBe("$1.00")

      // Verify file was written
      expect(existsSync(outputFile)).toBe(true)
    })

    it("should handle free content (200 instead of 402)", async () => {
      const freeContent = Buffer.from("free content")
      const outputFile = join(testDir, "free.dat")

      mockFetch.mockImplementation((url: string) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()

        if (urlStr.includes("/api/v1/skills/free-skill") && !urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: "free-skill",
              title: "Free Skill",
              payment_method: "x402",
              price: "0",
              seller: "0x" + "a".repeat(40),
            }))
          )
        }

        if (urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(freeContent, { status: 200 })
          )
        }

        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      const result = await commands.buyX402(
        { skillId: "free-skill", output: outputFile, yes: true },
        mockKeychain
      )

      expect(result.paymentFormatted).toBe("$0.00 (free)")
      expect(result.sizeBytes).toBe(freeContent.length)
    })
  })

  describe("re-download with tx_hash", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should re-download content with tx_hash", async () => {
      const reContent = Buffer.from("re-downloaded content")
      const outputFile = join(testDir, "redownload.dat")

      mockFetch.mockImplementation((url: string) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()
        if (urlStr.includes("/download") && urlStr.includes("tx_hash=")) {
          return Promise.resolve(
            new Response(reContent, {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            })
          )
        }
        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      const result = await commands.buyX402(
        { skillId: "test-skill", txHash: "0xabc123", output: outputFile },
        mockKeychain
      )

      expect(result.skillId).toBe("test-skill")
      expect(result.txHash).toBe("0xabc123")
      expect(result.paymentAmount).toBe("0")
      expect(result.sizeBytes).toBe(reContent.length)
      expect(existsSync(outputFile)).toBe(true)
    })

    it("should throw on re-download failure", async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve(
          new Response("Unauthorized", { status: 403 })
        )
      })

      await expect(
        commands.buyX402(
          { skillId: "test-skill", txHash: "0xwrong", output: join(testDir, "fail.dat") },
          mockKeychain
        )
      ).rejects.toThrow(/Re-download failed/)
    })
  })

  describe("payment rejection", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
      await mockKeychain.set("SX_KEY", testKey)
    })

    it("should throw on payment rejection (402 after payment)", async () => {
      mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString()

        if (urlStr.includes("/api/v1/skills/test-reject") && !urlStr.includes("/download")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: "test-reject",
              title: "Reject Skill",
              payment_method: "x402",
              price: "1000000",
              seller: "0x" + "a".repeat(40),
            }))
          )
        }

        if (urlStr.includes("/download")) {
          const headers = opts?.headers as Record<string, string> | undefined

          if (headers?.["X-Payment"]) {
            // Payment rejected
            return Promise.resolve(
              new Response(JSON.stringify({
                error: "Insufficient USDC balance",
                details: "Sender has 0 USDC",
              }), { status: 402 })
            )
          }

          // Initial 402
          return Promise.resolve(
            new Response(JSON.stringify({
              x402Version: 2,
              paymentRequirements: [{
                scheme: "exact",
                network: "eip155:84532",
                maxAmountRequired: "1000000",
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                payTo: "0x" + "b".repeat(40),
              }],
            }), { status: 402 })
          )
        }

        return Promise.resolve(new Response("{}", { status: 200 }))
      })

      await expect(
        commands.buyX402({ skillId: "test-reject", yes: true }, mockKeychain)
      ).rejects.toThrow(/Payment rejected/)
    })
  })

  describe("missing SX_KEY", () => {
    let commands: typeof import("../src/commands")

    beforeEach(async () => {
      commands = await import("../src/commands")
    })

    it("should throw when SX_KEY is not set", async () => {
      await expect(
        commands.buyX402({ skillId: "test-123", yes: true }, mockKeychain)
      ).rejects.toThrow(/SX_KEY/)
    })
  })
})
