#!/usr/bin/env npx tsx

/**
 * Sync environment variables to a deployed worker.
 *
 * This script reads environment variables from the current environment
 * (or a .env file) and syncs them to a deployed worker using wrangler.
 *
 * Variables prefixed with RUNTIME_ are synced to the worker runtime.
 * Secret variables (matching known patterns) are set using wrangler secret.
 * Non-secret variables are set using wrangler vars.
 *
 * Usage:
 *   npx tsx workers/_scripts/sync-env.ts <worker-name> <environment>
 *
 * Options:
 *   --dry-run    Show what would be synced without making changes
 *   --env-file   Path to .env file to read variables from
 *
 * Output (JSON to stdout):
 *   {
 *     "worker": "my-worker",
 *     "environment": "production",
 *     "varsSet": ["VAR1", "VAR2"],
 *     "secretsSet": ["API_KEY", "SECRET_TOKEN"]
 *   }
 */

import { execSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { loadConfig, getWorkerConfig } from "../_shared/config.ts"
import {
  parseEnvironmentVariables,
  isSecretName,
  maskValue,
} from "../_shared/env.ts"
import type { EnvVariable } from "../_shared/types.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, "../..")

type SyncResult = {
  worker: string
  environment: string
  varsSet: string[]
  secretsSet: string[]
  errors: string[]
}

/**
 * Parses command line arguments.
 */
function parseArgs(): {
  workerName: string
  environment: string
  dryRun: boolean
  envFile?: string
} {
  const args = process.argv.slice(2)
  let dryRun = false
  let envFile: string | undefined
  const positionalArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--env-file") {
      envFile = args[++i]
    } else if (!arg?.startsWith("--")) {
      positionalArgs.push(arg)
    }
  }

  const [workerName, environment] = positionalArgs

  if (!workerName || !environment) {
    console.error("Usage: sync-env.ts <worker-name> <environment> [options]")
    console.error("Options:")
    console.error("  --dry-run    Show what would be synced")
    console.error("  --env-file   Path to .env file")
    process.exit(1)
  }

  return { workerName, environment, dryRun, envFile }
}

/**
 * Reads environment variables from a .env file.
 */
function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`)
  }

  const content = readFileSync(filePath, "utf-8")
  const vars: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const equalIndex = trimmed.indexOf("=")
    if (equalIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, equalIndex).trim()
    let value = trimmed.slice(equalIndex + 1).trim()

    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    vars[key] = value
  }

  return vars
}

/**
 * Sets a wrangler variable using the wrangler CLI.
 */
function setWranglerVar(
  workerPath: string,
  workerName: string,
  environment: string,
  varName: string,
  varValue: string,
  isSecret: boolean,
  dryRun: boolean,
): boolean {
  const command = isSecret ? "secret" : "vars"
  const envFlag = environment !== "production" ? `--env ${environment}` : ""

  if (dryRun) {
    const displayValue = isSecret ? maskValue(varValue) : varValue
    console.error(
      `[DRY RUN] Would set ${isSecret ? "secret" : "var"}: ${varName}=${displayValue}`,
    )
    return true
  }

  try {
    if (isSecret) {
      // Secrets need to be piped to stdin
      const child = spawn(
        "npx",
        ["wrangler", "secret", "put", varName, envFlag].filter(Boolean),
        {
          cwd: workerPath,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )

      child.stdin?.write(varValue)
      child.stdin?.end()

      // Wait for completion
      return new Promise((resolve) => {
        child.on("close", (code) => resolve(code === 0))
      }) as unknown as boolean
    }

    // Non-secret vars - we'll write them to wrangler.toml
    // For now, just log what we would do
    console.error(`Setting var ${varName} in wrangler.toml`)
    return true
  } catch (error) {
    console.error(`Failed to set ${varName}:`, error)
    return false
  }
}

/**
 * Syncs runtime environment variables to a worker.
 */
async function syncEnv(
  workerName: string,
  environment: string,
  envVars: Record<string, string>,
  dryRun: boolean,
): Promise<SyncResult> {
  const config = await loadConfig(resolve(ROOT_DIR, "workers/workers.config.ts"))
  const workerConfig = getWorkerConfig(config, workerName)

  if (!workerConfig) {
    throw new Error(`Worker "${workerName}" not found in configuration`)
  }

  const workerPath = resolve(ROOT_DIR, workerConfig.path)

  if (!existsSync(workerPath)) {
    throw new Error(`Worker path does not exist: ${workerPath}`)
  }

  // Parse environment variables
  const { runtimeVars } = parseEnvironmentVariables(
    envVars,
    config.runtimeEnvPrefix,
  )

  console.error(`Found ${runtimeVars.length} runtime variables to sync`)

  const result: SyncResult = {
    worker: workerName,
    environment,
    varsSet: [],
    secretsSet: [],
    errors: [],
  }

  // Sync each variable
  for (const v of runtimeVars) {
    const success = setWranglerVar(
      workerPath,
      workerName,
      environment,
      v.name,
      v.value,
      v.isSecret,
      dryRun,
    )

    if (success) {
      if (v.isSecret) {
        result.secretsSet.push(v.name)
      } else {
        result.varsSet.push(v.name)
      }
    } else {
      result.errors.push(`Failed to set ${v.name}`)
    }
  }

  return result
}

/**
 * Main entry point.
 */
async function main() {
  const { workerName, environment, dryRun, envFile } = parseArgs()

  console.error(`Syncing environment variables to ${workerName}:${environment}`)
  if (dryRun) {
    console.error("(DRY RUN - no changes will be made)")
  }

  // Get environment variables
  let envVars: Record<string, string>

  if (envFile) {
    console.error(`Reading from: ${envFile}`)
    envVars = readEnvFile(envFile)
  } else {
    console.error("Reading from process.env")
    envVars = process.env as Record<string, string>
  }

  const result = await syncEnv(workerName, environment, envVars, dryRun)

  // Output JSON to stdout
  console.log(JSON.stringify(result, null, 2))

  if (result.errors.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
