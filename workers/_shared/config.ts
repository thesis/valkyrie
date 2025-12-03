/**
 * Worker configuration system.
 *
 * This module provides utilities for loading and validating worker configurations,
 * as well as generating outputs for GitHub Actions matrix builds.
 */

import type {
  WorkersConfig,
  WorkerConfig,
  MatrixOutput,
  ChangeDetectionResult,
} from "./types.ts"

/**
 * Default workers configuration.
 * This should be customized for each project.
 */
export const defaultConfig: WorkersConfig = {
  zone: "example.com",
  previewSubdomain: "preview",
  runtimeEnvPrefix: "RUNTIME_",
  defaultEnvironments: ["production", "staging"],
  workers: {},
  accessConfig: {
    audience: "",
    teamDomain: "",
    allowedDomains: [],
  },
}

/**
 * Loads the workers configuration from the project.
 * Falls back to default config if not found.
 */
export async function loadConfig(
  configPath = "./workers.config.ts",
): Promise<WorkersConfig> {
  try {
    const module = await import(configPath)
    return validateConfig(module.default ?? module.workersConfig)
  } catch {
    console.warn(`Could not load config from ${configPath}, using defaults`)
    return defaultConfig
  }
}

/**
 * Validates a workers configuration object.
 */
export function validateConfig(config: unknown): WorkersConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid configuration: must be an object")
  }

  const c = config as Record<string, unknown>

  if (typeof c.zone !== "string" || !c.zone) {
    throw new Error("Invalid configuration: zone must be a non-empty string")
  }

  if (typeof c.previewSubdomain !== "string") {
    throw new Error("Invalid configuration: previewSubdomain must be a string")
  }

  if (typeof c.runtimeEnvPrefix !== "string") {
    throw new Error("Invalid configuration: runtimeEnvPrefix must be a string")
  }

  if (!c.workers || typeof c.workers !== "object") {
    throw new Error("Invalid configuration: workers must be an object")
  }

  for (const [name, worker] of Object.entries(
    c.workers as Record<string, unknown>,
  )) {
    validateWorkerConfig(name, worker)
  }

  return config as WorkersConfig
}

/**
 * Validates a single worker configuration.
 */
function validateWorkerConfig(name: string, config: unknown): void {
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid worker "${name}": must be an object`)
  }

  const w = config as Record<string, unknown>

  if (typeof w.path !== "string" || !w.path) {
    throw new Error(`Invalid worker "${name}": path must be a non-empty string`)
  }

  if (!Array.isArray(w.environments) || w.environments.length === 0) {
    throw new Error(
      `Invalid worker "${name}": environments must be a non-empty array`,
    )
  }

  if (!w.routes || typeof w.routes !== "object") {
    throw new Error(`Invalid worker "${name}": routes must be an object`)
  }

  for (const env of w.environments as string[]) {
    if (!(env in (w.routes as Record<string, unknown>))) {
      throw new Error(
        `Invalid worker "${name}": missing route for environment "${env}"`,
      )
    }
  }
}

/**
 * Gets a specific worker configuration by name.
 */
export function getWorkerConfig(
  config: WorkersConfig,
  workerName: string,
): WorkerConfig | undefined {
  return config.workers[workerName]
}

/**
 * Lists all worker names in the configuration.
 */
export function listWorkers(config: WorkersConfig): string[] {
  return Object.keys(config.workers)
}

/**
 * Generates a GitHub Actions matrix for deploying workers.
 */
export function generateMatrix(
  config: WorkersConfig,
  changedWorkers: string[],
  environments?: string[],
): MatrixOutput {
  const envs = environments ?? config.defaultEnvironments
  const include: MatrixOutput["include"] = []

  for (const workerName of changedWorkers) {
    const worker = config.workers[workerName]
    if (!worker) {
      console.warn(`Worker "${workerName}" not found in configuration`)
      continue
    }

    for (const environment of envs) {
      if (!worker.environments.includes(environment)) {
        continue
      }

      include.push({
        worker: workerName,
        environment,
        path: worker.path,
      })
    }
  }

  return { include }
}

/**
 * Generates a preview deployment matrix for a PR.
 */
export function generatePreviewMatrix(
  config: WorkersConfig,
  changedWorkers: string[],
): MatrixOutput {
  const include: MatrixOutput["include"] = []

  for (const workerName of changedWorkers) {
    const worker = config.workers[workerName]
    if (!worker || worker.previewEnabled === false) {
      continue
    }

    include.push({
      worker: workerName,
      environment: "preview",
      path: worker.path,
    })
  }

  return { include }
}

/**
 * Gets the preview subdomain for a PR.
 */
export function getPreviewSubdomain(
  config: WorkersConfig,
  prNumber: number,
): string {
  return `pr-${prNumber}.${config.previewSubdomain}.${config.zone}`
}

/**
 * Gets the preview route for a worker.
 */
export function getPreviewRoute(
  config: WorkersConfig,
  workerName: string,
  prNumber: number,
): string {
  const subdomain = getPreviewSubdomain(config, prNumber)
  return `${workerName}.${subdomain}/*`
}

/**
 * Filters workers based on change detection results.
 */
export function filterChangedWorkers(
  config: WorkersConfig,
  changes: ChangeDetectionResult,
): string[] {
  // If shared code changed, all workers need to be rebuilt
  if (changes.sharedChanged) {
    return listWorkers(config)
  }

  // Otherwise, only return workers that have direct changes
  return changes.changedWorkers.filter(
    (workerName) => workerName in config.workers,
  )
}

/**
 * Checks if a path is within a worker directory.
 */
export function isWorkerPath(config: WorkersConfig, filePath: string): boolean {
  return Object.values(config.workers).some((worker) =>
    filePath.startsWith(worker.path),
  )
}

/**
 * Gets the worker name from a file path.
 */
export function getWorkerFromPath(
  config: WorkersConfig,
  filePath: string,
): string | undefined {
  for (const [name, worker] of Object.entries(config.workers)) {
    if (filePath.startsWith(worker.path)) {
      return name
    }
  }
  return undefined
}

/**
 * Checks if a path is in the shared directory.
 */
export function isSharedPath(filePath: string): boolean {
  return (
    filePath.startsWith("workers/_shared/") ||
    filePath.startsWith("workers/_scripts/")
  )
}
