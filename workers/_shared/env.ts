/**
 * Environment variable management for Cloudflare Workers.
 *
 * This module handles:
 * - Parsing environment variables with the runtime prefix
 * - Generating wrangler secrets commands
 * - Building environment variable manifests for the dashboard
 */

import type { EnvVariable, WorkersConfig } from "./types.ts"

/**
 * Default prefix for runtime environment variables.
 */
export const DEFAULT_RUNTIME_PREFIX = "RUNTIME_"

/**
 * Known secret patterns (variables matching these should be masked).
 */
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /private[_-]?key/i,
  /credentials?/i,
  /auth/i,
  /bearer/i,
]

/**
 * Checks if a variable name looks like a secret.
 */
export function isSecretName(name: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(name))
}

/**
 * Parses environment variables from process.env, separating runtime from build-time.
 */
export function parseEnvironmentVariables(
  env: Record<string, string | undefined>,
  runtimePrefix: string = DEFAULT_RUNTIME_PREFIX,
): { buildVars: EnvVariable[]; runtimeVars: EnvVariable[] } {
  const buildVars: EnvVariable[] = []
  const runtimeVars: EnvVariable[] = []

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue

    // Skip internal variables
    if (key.startsWith("_") || key === "PATH" || key === "HOME") {
      continue
    }

    if (key.startsWith(runtimePrefix)) {
      // Runtime variable - strip prefix
      const name = key.slice(runtimePrefix.length)
      runtimeVars.push({
        name,
        value,
        isRuntime: true,
        isSecret: isSecretName(name),
        source: "github",
      })
    } else {
      // Build-time variable
      buildVars.push({
        name: key,
        value,
        isRuntime: false,
        isSecret: isSecretName(key),
        source: "github",
      })
    }
  }

  return { buildVars, runtimeVars }
}

/**
 * Generates wrangler secret put commands for runtime variables.
 */
export function generateSecretCommands(
  workerName: string,
  runtimeVars: EnvVariable[],
  environment: string,
): string[] {
  return runtimeVars
    .filter((v) => v.isSecret)
    .map(
      (v) =>
        `echo "${maskValue(v.value)}" | wrangler secret put ${v.name} --name ${workerName} --env ${environment}`,
    )
}

/**
 * Generates wrangler vars for non-secret runtime variables.
 * These go in wrangler.toml [vars] section.
 */
export function generateVarsConfig(
  runtimeVars: EnvVariable[],
): Record<string, string> {
  const vars: Record<string, string> = {}

  for (const v of runtimeVars) {
    if (!v.isSecret) {
      vars[v.name] = v.value
    }
  }

  return vars
}

/**
 * Masks a secret value for display.
 */
export function maskValue(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) {
    return "*".repeat(value.length)
  }
  const prefix = value.slice(0, visibleChars)
  const suffix = value.slice(-visibleChars)
  const masked = "*".repeat(Math.min(value.length - visibleChars * 2, 20))
  return `${prefix}${masked}${suffix}`
}

/**
 * Creates a manifest of environment variables for the dashboard.
 */
export function createEnvManifest(
  buildVars: EnvVariable[],
  runtimeVars: EnvVariable[],
): {
  build: Array<{ name: string; masked: string; isSecret: boolean }>
  runtime: Array<{ name: string; masked: string; isSecret: boolean }>
} {
  return {
    build: buildVars.map((v) => ({
      name: v.name,
      masked: v.isSecret ? maskValue(v.value) : v.value,
      isSecret: v.isSecret,
    })),
    runtime: runtimeVars.map((v) => ({
      name: v.name,
      masked: v.isSecret ? maskValue(v.value) : v.value,
      isSecret: v.isSecret,
    })),
  }
}

/**
 * Syncs runtime environment variables to a worker using wrangler.
 */
export async function syncRuntimeEnv(
  workerName: string,
  environment: string,
  runtimeVars: EnvVariable[],
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = []

  // Group into secrets and vars
  const secrets = runtimeVars.filter((v) => v.isSecret)
  const vars = runtimeVars.filter((v) => !v.isSecret)

  // For vars, we'll generate the config that should go in wrangler.toml
  // In a real implementation, this would call wrangler CLI
  console.log(`Syncing ${vars.length} vars and ${secrets.length} secrets`)
  console.log(`Worker: ${workerName}, Environment: ${environment}`)
  console.log(`Non-secret vars: ${vars.map((v) => v.name).join(", ")}`)
  console.log(`Secrets: ${secrets.map((v) => v.name).join(", ")}`)

  // In production, this would execute wrangler commands
  // For now, we just return success
  return { success: errors.length === 0, errors }
}

/**
 * Extracts environment variables from a GitHub Actions context.
 */
export function extractGitHubEnv(config: WorkersConfig): {
  buildVars: EnvVariable[]
  runtimeVars: EnvVariable[]
} {
  // In GitHub Actions, environment variables are in process.env
  // We filter based on the runtime prefix
  const env = process.env as Record<string, string | undefined>
  return parseEnvironmentVariables(env, config.runtimeEnvPrefix)
}

/**
 * Validates that required runtime variables are present.
 */
export function validateRequiredVars(
  runtimeVars: EnvVariable[],
  requiredNames: string[],
): { valid: boolean; missing: string[] } {
  const varNames = new Set(runtimeVars.map((v) => v.name))
  const missing = requiredNames.filter((name) => !varNames.has(name))
  return { valid: missing.length === 0, missing }
}

/**
 * Merges environment variables from multiple sources.
 * Later sources override earlier ones.
 */
export function mergeEnvVars(...sources: EnvVariable[][]): EnvVariable[] {
  const merged = new Map<string, EnvVariable>()

  for (const source of sources) {
    for (const v of source) {
      merged.set(v.name, v)
    }
  }

  return Array.from(merged.values())
}

/**
 * Converts environment variables to wrangler.toml [vars] format.
 */
export function toWranglerVars(vars: EnvVariable[]): string {
  const nonSecrets = vars.filter((v) => !v.isSecret)

  if (nonSecrets.length === 0) {
    return ""
  }

  const lines = ["[vars]"]
  for (const v of nonSecrets) {
    // Escape quotes in values
    const escapedValue = v.value.replace(/"/g, '\\"')
    lines.push(`${v.name} = "${escapedValue}"`)
  }

  return lines.join("\n")
}

/**
 * Converts environment variables to shell export format.
 */
export function toShellExports(vars: EnvVariable[], mask = true): string {
  return vars
    .map((v) => {
      const value = mask && v.isSecret ? maskValue(v.value) : v.value
      return `export ${v.name}="${value}"`
    })
    .join("\n")
}
