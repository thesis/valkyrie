#!/usr/bin/env npx tsx

/**
 * Detect which workers have changes compared to the base branch.
 *
 * This script is used by GitHub Actions to determine which workers
 * need to be built and deployed.
 *
 * Usage:
 *   npx tsx workers/_scripts/detect-changes.ts [base-ref]
 *
 * Output (JSON to stdout):
 *   {
 *     "changedWorkers": ["worker1", "worker2"],
 *     "sharedChanged": false,
 *     "changedFiles": ["workers/worker1/src/index.ts"],
 *     "matrix": { "include": [...] }
 *   }
 */

import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import type { ChangeDetectionResult, MatrixOutput } from "../_shared/types.ts"
import {
  loadConfig,
  getWorkerFromPath,
  isSharedPath,
  generateMatrix,
  generatePreviewMatrix,
  listWorkers,
} from "../_shared/config.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, "../..")

type DetectChangesOutput = ChangeDetectionResult & {
  matrix: MatrixOutput
  previewMatrix: MatrixOutput
  hasChanges: boolean
}

/**
 * Gets the list of changed files between two refs using git.
 */
function getChangedFiles(baseRef: string, headRef = "HEAD"): string[] {
  try {
    // First, fetch the base ref to ensure we have it
    try {
      execSync(`git fetch origin ${baseRef} --depth=1`, {
        cwd: ROOT_DIR,
        stdio: "pipe",
      })
    } catch {
      // Ignore fetch errors - ref might already be available
    }

    const output = execSync(
      `git diff --name-only origin/${baseRef}...${headRef}`,
      {
        cwd: ROOT_DIR,
        encoding: "utf-8",
      },
    )

    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
  } catch (error) {
    console.error("Error getting changed files:", error)

    // Fallback: get all files in workers directory
    const output = execSync('git ls-files "workers/"', {
      cwd: ROOT_DIR,
      encoding: "utf-8",
    })

    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
  }
}

/**
 * Detects which workers have changes.
 */
async function detectChanges(baseRef: string): Promise<DetectChangesOutput> {
  const config = await loadConfig(resolve(ROOT_DIR, "workers/workers.config.ts"))
  const changedFiles = getChangedFiles(baseRef)

  // Filter to only worker-related files
  const workerFiles = changedFiles.filter(
    (file) =>
      file.startsWith("workers/") ||
      file === "workers.config.ts" ||
      file.includes("wrangler"),
  )

  // Check if shared code changed
  const sharedChanged = workerFiles.some(
    (file) => isSharedPath(file) || file === "workers/workers.config.ts",
  )

  // Find which workers have direct changes
  const changedWorkersSet = new Set<string>()

  for (const file of workerFiles) {
    const workerName = getWorkerFromPath(config, file)
    if (workerName) {
      changedWorkersSet.add(workerName)
    }
  }

  // If shared code changed, all workers are affected
  const changedWorkers = sharedChanged
    ? listWorkers(config)
    : Array.from(changedWorkersSet)

  const result: ChangeDetectionResult = {
    changedWorkers,
    sharedChanged,
    changedFiles: workerFiles,
  }

  // Generate matrices for GitHub Actions
  const matrix = generateMatrix(config, changedWorkers)
  const previewMatrix = generatePreviewMatrix(config, changedWorkers)

  return {
    ...result,
    matrix,
    previewMatrix,
    hasChanges: changedWorkers.length > 0,
  }
}

/**
 * Main entry point.
 */
async function main() {
  const baseRef = process.argv[2] ?? "main"

  console.error(`Detecting changes against: ${baseRef}`)

  const result = await detectChanges(baseRef)

  console.error(`Changed workers: ${result.changedWorkers.join(", ") || "none"}`)
  console.error(`Shared code changed: ${result.sharedChanged}`)
  console.error(`Total changed files: ${result.changedFiles.length}`)

  // Output JSON to stdout for GitHub Actions
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
