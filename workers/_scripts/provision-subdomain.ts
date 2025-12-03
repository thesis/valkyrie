#!/usr/bin/env npx tsx

/**
 * Provision a subdomain for PR preview deployments.
 *
 * This script creates a DNS record pointing to the workers.dev domain
 * and records the deployment in D1 for tracking.
 *
 * Usage:
 *   npx tsx workers/_scripts/provision-subdomain.ts <pr-number>
 *
 * Required environment variables:
 *   CLOUDFLARE_API_TOKEN - API token with Zone:DNS:Edit permissions
 *   CLOUDFLARE_ZONE_ID - Zone ID for the DNS zone
 *   CLOUDFLARE_ACCOUNT_ID - Account ID
 *
 * Output (JSON to stdout):
 *   {
 *     "subdomain": "pr-123.preview.example.com",
 *     "dnsRecordId": "abc123",
 *     "workersDevUrl": "pr-123-preview.workers.dev"
 *   }
 */

import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { loadConfig, getPreviewSubdomain } from "../_shared/config.ts"
import type { PreviewDeployment } from "../_shared/types.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, "../..")

type CloudflareDNSRecord = {
  id: string
  name: string
  type: string
  content: string
  proxied: boolean
  ttl: number
}

type CloudflareAPIResponse<T> = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: string[]
  result: T
}

/**
 * Cloudflare API client for DNS operations.
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
   * Creates a DNS CNAME record pointing to workers.dev.
   */
  async createDNSRecord(
    subdomain: string,
    target: string,
  ): Promise<CloudflareDNSRecord> {
    const response = await this.request<CloudflareDNSRecord>(
      "POST",
      `/zones/${this.zoneId}/dns_records`,
      {
        type: "CNAME",
        name: subdomain,
        content: target,
        proxied: true,
        ttl: 1, // Auto TTL when proxied
      },
    )

    return response.result
  }

  /**
   * Checks if a DNS record already exists.
   */
  async findDNSRecord(
    subdomain: string,
  ): Promise<CloudflareDNSRecord | undefined> {
    const response = await this.request<CloudflareDNSRecord[]>(
      "GET",
      `/zones/${this.zoneId}/dns_records?name=${encodeURIComponent(subdomain)}&type=CNAME`,
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
   * Gets the workers.dev subdomain for a worker.
   */
  getWorkersDevDomain(workerName: string, environment: string): string {
    // Format: worker-name-environment.account-subdomain.workers.dev
    // The actual format depends on your Cloudflare configuration
    return `${workerName}-${environment}.workers.dev`
  }
}

/**
 * Provisions a preview subdomain for a PR.
 */
async function provisionSubdomain(prNumber: number): Promise<{
  subdomain: string
  dnsRecordId: string
  workersDevUrl: string
}> {
  const config = await loadConfig(resolve(ROOT_DIR, "workers/workers.config.ts"))
  const cf = new CloudflareAPI()

  // Generate the subdomain
  const subdomain = getPreviewSubdomain(config, prNumber)

  console.error(`Provisioning subdomain: ${subdomain}`)

  // Check if record already exists
  const existingRecord = await cf.findDNSRecord(subdomain)
  if (existingRecord) {
    console.error(`DNS record already exists: ${existingRecord.id}`)
    return {
      subdomain,
      dnsRecordId: existingRecord.id,
      workersDevUrl: existingRecord.content,
    }
  }

  // Create a wildcard CNAME pointing to workers.dev
  // Workers will handle routing based on the subdomain
  const workersDevUrl = cf.getWorkersDevDomain(`pr-${prNumber}`, "preview")

  const record = await cf.createDNSRecord(subdomain, workersDevUrl)

  console.error(`Created DNS record: ${record.id}`)

  return {
    subdomain,
    dnsRecordId: record.id,
    workersDevUrl,
  }
}

/**
 * Main entry point.
 */
async function main() {
  const prNumberArg = process.argv[2]

  if (!prNumberArg) {
    console.error("Usage: provision-subdomain.ts <pr-number>")
    process.exit(1)
  }

  const prNumber = Number.parseInt(prNumberArg, 10)

  if (Number.isNaN(prNumber) || prNumber <= 0) {
    console.error("PR number must be a positive integer")
    process.exit(1)
  }

  const result = await provisionSubdomain(prNumber)

  // Output JSON to stdout for GitHub Actions
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
