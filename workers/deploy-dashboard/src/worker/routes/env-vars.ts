/**
 * Environment Variables API Routes
 *
 * Manage environment variables associated with deployments.
 */

import { Hono } from "hono"
import type { Env, EnvVarRecord, ApiResponse } from "../types.ts"
import { CreateEnvVarsRequest } from "../types.ts"
import { requirePermission } from "../middleware/auth.ts"

export const envVarsRouter = new Hono<{ Bindings: Env }>()

/**
 * List environment variables for a deployment.
 *
 * GET /api/env-vars/:deploymentId
 * Query params:
 *   - type: Filter by type ('build', 'runtime', or 'all')
 */
envVarsRouter.get("/:deploymentId", async (c) => {
  const deploymentId = c.req.param("deploymentId")
  const type = c.req.query("type") ?? "all"

  let whereClause = "deployment_id = ?"
  if (type === "build") {
    whereClause += " AND is_runtime = 0"
  } else if (type === "runtime") {
    whereClause += " AND is_runtime = 1"
  }

  const results = await c.env.DB.prepare(
    `SELECT * FROM environment_variables WHERE ${whereClause} ORDER BY name`,
  )
    .bind(deploymentId)
    .all<EnvVarRecord>()

  return c.json({
    success: true,
    data: results.results ?? [],
  } as ApiResponse<EnvVarRecord[]>)
})

/**
 * Create environment variables for a deployment.
 *
 * POST /api/env-vars
 */
envVarsRouter.post("/", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const parsed = CreateEnvVarsRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data
  const now = new Date().toISOString()

  try {
    // Delete existing vars for this deployment to replace them
    await c.env.DB.prepare(
      "DELETE FROM environment_variables WHERE deployment_id = ?",
    )
      .bind(data.deploymentId)
      .run()

    // Insert new vars
    for (const v of data.variables) {
      await c.env.DB.prepare(
        `INSERT INTO environment_variables
         (deployment_id, name, masked_value, is_runtime, is_secret, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          data.deploymentId,
          v.name,
          v.maskedValue,
          v.isRuntime ? 1 : 0,
          v.isSecret ? 1 : 0,
          v.source,
          now,
        )
        .run()
    }

    return c.json({
      success: true,
      data: { count: data.variables.length },
    } as ApiResponse<{ count: number }>, 201)
  } catch (error) {
    console.error("Failed to create env vars:", error)
    return c.json(
      { success: false, error: "Failed to create environment variables" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Get environment variables summary for a worker across environments.
 *
 * GET /api/env-vars/summary/:workerName
 */
envVarsRouter.get("/summary/:workerName", async (c) => {
  const workerName = c.req.param("workerName")

  const results = await c.env.DB.prepare(
    `SELECT
       d.environment,
       COUNT(CASE WHEN ev.is_runtime = 1 THEN 1 END) as runtime_vars,
       COUNT(CASE WHEN ev.is_runtime = 0 THEN 1 END) as build_vars,
       COUNT(CASE WHEN ev.is_secret = 1 THEN 1 END) as secret_vars
     FROM deployments d
     LEFT JOIN environment_variables ev ON d.id = ev.deployment_id
     WHERE d.worker_name = ? AND d.status = 'deployed'
     GROUP BY d.environment`,
  )
    .bind(workerName)
    .all()

  return c.json({
    success: true,
    data: results.results ?? [],
  } as ApiResponse<unknown[]>)
})

/**
 * Compare environment variables between two deployments.
 *
 * GET /api/env-vars/compare
 * Query params:
 *   - deploymentA: First deployment ID
 *   - deploymentB: Second deployment ID
 */
envVarsRouter.get("/compare", async (c) => {
  const deploymentA = c.req.query("deploymentA")
  const deploymentB = c.req.query("deploymentB")

  if (!deploymentA || !deploymentB) {
    return c.json(
      { success: false, error: "Both deploymentA and deploymentB are required" } as ApiResponse<never>,
      400,
    )
  }

  const [varsA, varsB] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM environment_variables WHERE deployment_id = ?",
    )
      .bind(deploymentA)
      .all<EnvVarRecord>(),
    c.env.DB.prepare(
      "SELECT * FROM environment_variables WHERE deployment_id = ?",
    )
      .bind(deploymentB)
      .all<EnvVarRecord>(),
  ])

  const mapA = new Map((varsA.results ?? []).map((v) => [v.name, v]))
  const mapB = new Map((varsB.results ?? []).map((v) => [v.name, v]))

  const allNames = new Set([...mapA.keys(), ...mapB.keys()])

  const comparison = Array.from(allNames).map((name) => {
    const a = mapA.get(name)
    const b = mapB.get(name)

    let status: "added" | "removed" | "changed" | "unchanged"
    if (!a) {
      status = "added"
    } else if (!b) {
      status = "removed"
    } else if (a.masked_value !== b.masked_value) {
      status = "changed"
    } else {
      status = "unchanged"
    }

    return {
      name,
      status,
      deploymentA: a ?? null,
      deploymentB: b ?? null,
    }
  })

  return c.json({
    success: true,
    data: comparison,
  } as ApiResponse<typeof comparison>)
})
