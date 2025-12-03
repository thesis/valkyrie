#!/usr/bin/env npx tsx

/**
 * Deprovision a subdomain when a PR is closed or merged.
 *
 * This script removes the DNS record and cleans up the deployment
 * records in D1.
 *
 * Usage:
 *   npx tsx workers/_scripts/deprovision-subdomain.ts <pr-number>
 *
 * Required environment variables:
 *   CLOUDFLARE_API_TOKEN - API token with Zone:DNS:Edit permissions
 *   CLOUDFLARE_ZONE_ID - Zone ID for the DNS zone
 *   CLOUDFLARE_ACCOUNT_ID - Account ID
 *
 * Output (JSON to stdout):
 *   {
 *     "subdomain": "pr-123.preview.example.com",
 *     "deleted": true,
 *     "workersDeleted": ["worker1", "worker2"]
 *   }
 */

import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

import { loadConfig, getPreviewSubdomain } from "../_shared/config.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, "../..")

type CloudflareDNSRecord = {
  id: string
  name: string
  type: string
  content: string
}

type CloudflareAPIResponse<T> = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: string[]
  result: T
}

/**
 * Cloudflare API client for cleanup operations.
 */
class CloudflareAPI {
  private apiToken: string
  private zoneId: string
  private accountId: string
  private baseUrl = "https://api.cloudflare.com/client/v4"

  constructor() {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN
    const zoneId = process.env.CLOUDFLARE_ZONE_ID
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID

    if (!apiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN environment variable is required")
    }
    if (!zoneId) {
      throw new Error("CLOUDFLARE_ZONE_ID environment variable is required")
    }
    if (!accountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID environment variable is required")
    }

    this.apiToken = apiToken
    this.zoneId = zoneId
    this.accountId = accountId
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<CloudflareAPIResponse<T>> {
    const url = `${this.baseUrl}${path}`
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = (await response.json()) as CloudflareAPIResponse<T>

    if (!data.success) {
      const errorMessages = data.errors.map((e) => e.message).join(", ")
      throw new Error(`Cloudflare API error: ${errorMessages}`)
    }

    return data
  }

  /**
   * Finds DNS records matching a subdomain pattern.
   */
  async findDNSRecords(subdomainPattern: string): Promise<CloudflareDNSRecord[]> {
    const response = await this.request<CloudflareDNSRecord[]>(
      "GET",
      `/zones/${this.zoneId}/dns_records?name=contains:${encodeURIComponent(subdomainPattern)}`,
    )

    return response.result
  }

  /**
   * Finds a specific DNS record by full name.
   */
  async findDNSRecord(
    subdomain: string,
  ): Promise<CloudflareDNSRecord | undefined> {
    const response = await this.request<CloudflareDNSRecord[]>(
      "GET",
      `/zones/${this.zoneId}/dns_records?name=${encodeURIComponent(subdomain)}`,
    )

    return response.result[0]
  }

  /**
   * Deletes a DNS record by ID.
   */
  async deleteDNSRecord(recordId: string): Promise<void> {
    await this.request("DELETE", `/zones/${this.zoneId}/dns_records/${recordId}`)
  }

  /**
   * Deletes a worker by name.
   */
  async deleteWorker(workerName: string): Promise<void> {
    await this.request(
      "DELETE",
      `/accounts/${this.accountId}/workers/scripts/${workerName}`,
    )
  }

  /**
   * Lists all workers matching a pattern.
   */
  async listWorkers(pattern?: string): Promise<string[]> {
    const response = await this.request<Array<{ id: string }>>(
      "GET",
      `/accounts/${this.accountId}/workers/scripts`,
    )

    const workerNames = response.result.map((w) => w.id)

    if (pattern) {
      return workerNames.filter((name) => name.includes(pattern))
    }

    return workerNames
  }
}

/**
 * Deprovisions a preview subdomain for a PR.
 */
async function deprovisionSubdomain(prNumber: number): Promise<{
  subdomain: string
  deleted: boolean
  dnsRecordDeleted: boolean
  workersDeleted: string[]
}> {
  const config = await loadConfig(resolve(ROOT_DIR, "workers/workers.config.ts"))
  const cf = new CloudflareAPI()

  // Generate the subdomain
  const subdomain = getPreviewSubdomain(config, prNumber)

  console.error(`Deprovisioning subdomain: ${subdomain}`)

  // Find and delete the DNS record
  let dnsRecordDeleted = false
  const record = await cf.findDNSRecord(subdomain)

  if (record) {
    console.error(`Deleting DNS record: ${record.id}`)
    await cf.deleteDNSRecord(record.id)
    dnsRecordDeleted = true
  } else {
    console.error("No DNS record found to delete")
  }

  // Find and delete preview workers
  const workersDeleted: string[] = []
  const previewPattern = `pr-${prNumber}-`

  try {
    const workers = await cf.listWorkers(previewPattern)

    for (const workerName of workers) {
      console.error(`Deleting worker: ${workerName}`)
      try {
        await cf.deleteWorker(workerName)
        workersDeleted.push(workerName)
      } catch (error) {
        console.error(`Failed to delete worker ${workerName}:`, error)
      }
    }
  } catch (error) {
    console.error("Failed to list workers:", error)
  }

  // Also try to delete workers using wrangler (for local environments)
  try {
    for (const [workerName] of Object.entries(config.workers)) {
      const previewWorkerName = `pr-${prNumber}-${workerName}`
      try {
        execSync(`wrangler delete --name ${previewWorkerName} --force`, {
          cwd: ROOT_DIR,
          stdio: "pipe",
        })
        if (!workersDeleted.includes(previewWorkerName)) {
          workersDeleted.push(previewWorkerName)
        }
      } catch {
        // Worker might not exist, ignore
      }
    }
  } catch {
    // Ignore wrangler errors
  }

  return {
    subdomain,
    deleted: dnsRecordDeleted || workersDeleted.length > 0,
    dnsRecordDeleted,
    workersDeleted,
  }
}

/**
 * Main entry point.
 */
async function main() {
  const prNumberArg = process.argv[2]

  if (!prNumberArg) {
    console.error("Usage: deprovision-subdomain.ts <pr-number>")
    process.exit(1)
  }

  const prNumber = Number.parseInt(prNumberArg, 10)

  if (Number.isNaN(prNumber) || prNumber <= 0) {
    console.error("PR number must be a positive integer")
    process.exit(1)
  }

  const result = await deprovisionSubdomain(prNumber)

  // Output JSON to stdout for GitHub Actions
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
