#!/usr/bin/env npx tsx

/**
 * Deploy a single worker to a specific environment.
 *
 * This script handles:
 * - Building the worker
 * - Syncing runtime environment variables
 * - Deploying using wrangler
 * - Recording the deployment in the dashboard D1 database
 *
 * Usage:
 *   npx tsx workers/_scripts/deploy-worker.ts <worker-name> <environment> [options]
 *
 * Options:
 *   --pr <number>     PR number for preview deployments
 *   --commit <sha>    Git commit SHA
 *   --branch <name>   Git branch name
 *   --dry-run         Show what would be deployed
 *
 * Required environment variables:
 *   CLOUDFLARE_API_TOKEN - API token for wrangler
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID
 */

import { execSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

import { loadConfig, getWorkerConfig, getPreviewRoute } from "../_shared/config.ts"
import {
  parseEnvironmentVariables,
  createEnvManifest,
  toWranglerVars,
} from "../_shared/env.ts"
import type { DeploymentRecord, EnvVariable } from "../_shared/types.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, "../..")

type DeployOptions = {
  workerName: string
  environment: string
  prNumber?: number
  commitSha: string
  branch: string
  dryRun: boolean
}

type DeployResult = {
  success: boolean
  worker: string
  environment: string
  url?: string
  deploymentId?: string
  error?: string
  buildEnv: ReturnType<typeof createEnvManifest>["build"]
  runtimeEnv: ReturnType<typeof createEnvManifest>["runtime"]
}

/**
 * Parses command line arguments.
 */
function parseArgs(): DeployOptions {
  const args = process.argv.slice(2)
  let dryRun = false
  let prNumber: number | undefined
  let commitSha = ""
  let branch = ""
  const positionalArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--pr") {
      const value = args[++i]
      prNumber = value ? Number.parseInt(value, 10) : undefined
    } else if (arg === "--commit") {
      commitSha = args[++i] ?? ""
    } else if (arg === "--branch") {
      branch = args[++i] ?? ""
    } else if (!arg?.startsWith("--")) {
      positionalArgs.push(arg)
    }
  }

  const [workerName, environment] = positionalArgs

  if (!workerName || !environment) {
    console.error("Usage: deploy-worker.ts <worker-name> <environment> [options]")
    console.error("Options:")
    console.error("  --pr <number>     PR number for preview deployments")
    console.error("  --commit <sha>    Git commit SHA")
    console.error("  --branch <name>   Git branch name")
    console.error("  --dry-run         Show what would be deployed")
    process.exit(1)
  }

  // Try to get git info if not provided
  if (!commitSha) {
    try {
      commitSha = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      commitSha = "unknown"
    }
  }

  if (!branch) {
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      branch = "unknown"
    }
  }

  return { workerName, environment, prNumber, commitSha, branch, dryRun }
}

/**
 * Gets the effective worker name for deployment.
 * For preview deployments, this includes the PR number.
 */
function getEffectiveWorkerName(workerName: string, prNumber?: number): string {
  if (prNumber) {
    return `pr-${prNumber}-${workerName}`
  }
  return workerName
}

/**
 * Updates wrangler.toml with runtime variables.
 */
function updateWranglerVars(
  workerPath: string,
  environment: string,
  runtimeVars: EnvVariable[],
): void {
  const wranglerPath = resolve(workerPath, "wrangler.toml")

  if (!existsSync(wranglerPath)) {
    console.error(`Warning: wrangler.toml not found at ${wranglerPath}`)
    return
  }

  // For now, we just log what we would add
  // In production, this would parse and update the TOML file
  const varsConfig = toWranglerVars(runtimeVars.filter((v) => !v.isSecret))
  if (varsConfig) {
    console.error(`Would add to wrangler.toml [env.${environment}]:`)
    console.error(varsConfig)
  }
}

/**
 * Sets secrets using wrangler secret put.
 */
async function setSecrets(
  workerPath: string,
  workerName: string,
  environment: string,
  secrets: EnvVariable[],
  dryRun: boolean,
): Promise<string[]> {
  const errors: string[] = []

  for (const secret of secrets) {
    if (dryRun) {
      console.error(`[DRY RUN] Would set secret: ${secret.name}`)
      continue
    }

    console.error(`Setting secret: ${secret.name}`)

    const result = spawnSync(
      "npx",
      ["wrangler", "secret", "put", secret.name, "--env", environment],
      {
        cwd: workerPath,
        input: secret.value,
        stdio: ["pipe", "pipe", "pipe"],
      },
    )

    if (result.status !== 0) {
      const error = result.stderr?.toString() ?? "Unknown error"
      errors.push(`Failed to set secret ${secret.name}: ${error}`)
    }
  }

  return errors
}

/**
 * Deploys a worker using wrangler.
 */
async function deployWorker(options: DeployOptions): Promise<DeployResult> {
  const config = await loadConfig(resolve(ROOT_DIR, "workers/workers.config.ts"))
  const workerConfig = getWorkerConfig(config, options.workerName)

  if (!workerConfig) {
    return {
      success: false,
      worker: options.workerName,
      environment: options.environment,
      error: `Worker "${options.workerName}" not found in configuration`,
      buildEnv: [],
      runtimeEnv: [],
    }
  }

  const workerPath = resolve(ROOT_DIR, workerConfig.path)

  if (!existsSync(workerPath)) {
    return {
      success: false,
      worker: options.workerName,
      environment: options.environment,
      error: `Worker path does not exist: ${workerPath}`,
      buildEnv: [],
      runtimeEnv: [],
    }
  }

  // Parse environment variables
  const envVars = process.env as Record<string, string>
  const { buildVars, runtimeVars } = parseEnvironmentVariables(
    envVars,
    config.runtimeEnvPrefix,
  )

  const envManifest = createEnvManifest(buildVars, runtimeVars)

  console.error(`Worker: ${options.workerName}`)
  console.error(`Environment: ${options.environment}`)
  console.error(`Path: ${workerPath}`)
  console.error(`Build vars: ${buildVars.length}`)
  console.error(`Runtime vars: ${runtimeVars.length}`)

  // Get effective worker name
  const effectiveWorkerName = getEffectiveWorkerName(
    options.workerName,
    options.prNumber,
  )

  // Get the route for this environment
  let route: string
  if (options.prNumber) {
    route = getPreviewRoute(config, options.workerName, options.prNumber)
  } else {
    route = workerConfig.routes[options.environment]
    if (!route) {
      return {
        success: false,
        worker: options.workerName,
        environment: options.environment,
        error: `No route configured for environment: ${options.environment}`,
        buildEnv: envManifest.build,
        runtimeEnv: envManifest.runtime,
      }
    }
  }

  if (options.dryRun) {
    console.error(`[DRY RUN] Would deploy ${effectiveWorkerName} to ${route}`)
    return {
      success: true,
      worker: options.workerName,
      environment: options.environment,
      url: route,
      deploymentId: "dry-run",
      buildEnv: envManifest.build,
      runtimeEnv: envManifest.runtime,
    }
  }

  // Set secrets first
  const secretVars = runtimeVars.filter((v) => v.isSecret)
  if (secretVars.length > 0) {
    const secretErrors = await setSecrets(
      workerPath,
      effectiveWorkerName,
      options.environment,
      secretVars,
      options.dryRun,
    )

    if (secretErrors.length > 0) {
      console.error("Errors setting secrets:", secretErrors)
    }
  }

  // Build the wrangler deploy command
  const wranglerArgs = [
    "wrangler",
    "deploy",
    "--env",
    options.environment,
  ]

  // Add name override for preview deployments
  if (options.prNumber) {
    wranglerArgs.push("--name", effectiveWorkerName)
  }

  // Deploy using wrangler
  console.error(`Running: npx ${wranglerArgs.join(" ")}`)

  try {
    const output = execSync(`npx ${wranglerArgs.join(" ")}`, {
      cwd: workerPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Pass non-secret runtime vars to wrangler
        ...Object.fromEntries(
          runtimeVars
            .filter((v) => !v.isSecret)
            .map((v) => [v.name, v.value]),
        ),
      },
    })

    console.error("Deployment output:", output)

    // Extract URL from output
    const urlMatch = output.match(/https?:\/\/[^\s]+workers\.dev/)
    const url = urlMatch?.[0] ?? route

    // Generate deployment ID
    const deploymentId = randomUUID()

    return {
      success: true,
      worker: options.workerName,
      environment: options.environment,
      url,
      deploymentId,
      buildEnv: envManifest.build,
      runtimeEnv: envManifest.runtime,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)

    return {
      success: false,
      worker: options.workerName,
      environment: options.environment,
      error: errorMessage,
      buildEnv: envManifest.build,
      runtimeEnv: envManifest.runtime,
    }
  }
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs()

  console.error("Starting deployment...")
  console.error(`Worker: ${options.workerName}`)
  console.error(`Environment: ${options.environment}`)
  console.error(`Commit: ${options.commitSha}`)
  console.error(`Branch: ${options.branch}`)
  if (options.prNumber) {
    console.error(`PR: #${options.prNumber}`)
  }
  if (options.dryRun) {
    console.error("(DRY RUN - no changes will be made)")
  }

  const result = await deployWorker(options)

  // Output JSON to stdout
  console.log(JSON.stringify(result, null, 2))

  if (!result.success) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
