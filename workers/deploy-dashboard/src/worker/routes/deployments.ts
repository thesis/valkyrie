/**
 * Deployments API Routes
 *
 * CRUD operations for deployment records.
 */

import { Hono } from "hono"
import type { Env, DeploymentRecord, ApiResponse, PaginatedResponse } from "../types.ts"
import {
  CreateDeploymentRequest,
  UpdateDeploymentRequest,
} from "../types.ts"
import { requirePermission } from "../middleware/auth.ts"

export const deploymentsRouter = new Hono<{ Bindings: Env }>()

/**
 * List all deployments with pagination and filtering.
 *
 * GET /api/deployments
 * Query params:
 *   - page: Page number (default: 1)
 *   - pageSize: Items per page (default: 20, max: 100)
 *   - worker: Filter by worker name
 *   - environment: Filter by environment
 *   - status: Filter by status
 *   - prNumber: Filter by PR number
 */
deploymentsRouter.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20))
  const worker = c.req.query("worker")
  const environment = c.req.query("environment")
  const status = c.req.query("status")
  const prNumber = c.req.query("prNumber")

  const offset = (page - 1) * pageSize

  // Build query with filters
  let whereClause = "1=1"
  const params: (string | number)[] = []

  if (worker) {
    whereClause += " AND worker_name = ?"
    params.push(worker)
  }
  if (environment) {
    whereClause += " AND environment = ?"
    params.push(environment)
  }
  if (status) {
    whereClause += " AND status = ?"
    params.push(status)
  }
  if (prNumber) {
    whereClause += " AND pr_number = ?"
    params.push(Number(prNumber))
  }

  // Get total count
  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM deployments WHERE ${whereClause}`,
  )
    .bind(...params)
    .first<{ count: number }>()

  const total = countResult?.count ?? 0

  // Get paginated results
  const results = await c.env.DB.prepare(
    `SELECT * FROM deployments
     WHERE ${whereClause}
     ORDER BY deployed_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<DeploymentRecord>()

  const response: PaginatedResponse<DeploymentRecord> = {
    success: true,
    data: {
      items: results.results ?? [],
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    },
  }

  return c.json(response)
})

/**
 * Get a single deployment by ID.
 *
 * GET /api/deployments/:id
 */
deploymentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")

  const deployment = await c.env.DB.prepare(
    "SELECT * FROM deployments WHERE id = ?",
  )
    .bind(id)
    .first<DeploymentRecord>()

  if (!deployment) {
    return c.json({ success: false, error: "Deployment not found" } as ApiResponse<never>, 404)
  }

  // Also fetch environment variables
  const envVars = await c.env.DB.prepare(
    "SELECT * FROM environment_variables WHERE deployment_id = ?",
  )
    .bind(id)
    .all()

  return c.json({
    success: true,
    data: {
      ...deployment,
      envVars: envVars.results ?? [],
    },
  } as ApiResponse<DeploymentRecord & { envVars: unknown[] }>)
})

/**
 * Create a new deployment record.
 *
 * POST /api/deployments
 */
deploymentsRouter.post("/", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const parsed = CreateDeploymentRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data
  const now = new Date().toISOString()

  try {
    await c.env.DB.prepare(
      `INSERT INTO deployments
       (id, worker_name, environment, pr_number, commit_sha, branch, url, status, deployed_at, updated_at, repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'deployed', ?, ?, ?)`,
    )
      .bind(
        data.deploymentId,
        data.worker,
        data.environment,
        data.prNumber ?? null,
        data.commitSha,
        data.branch,
        data.url ?? null,
        data.deployedAt,
        now,
        data.repository,
      )
      .run()

    // Record in history
    await c.env.DB.prepare(
      `INSERT INTO deployment_history (deployment_id, event_type, event_data, created_at)
       VALUES (?, 'created', ?, ?)`,
    )
      .bind(data.deploymentId, JSON.stringify(data), now)
      .run()

    return c.json({
      success: true,
      data: { id: data.deploymentId },
    } as ApiResponse<{ id: string }>, 201)
  } catch (error) {
    console.error("Failed to create deployment:", error)
    return c.json(
      { success: false, error: "Failed to create deployment" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Update a deployment record.
 *
 * PATCH /api/deployments/:id
 */
deploymentsRouter.patch("/:id", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const id = c.req.param("id")
  const body = await c.req.json()
  const parsed = UpdateDeploymentRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data
  const now = new Date().toISOString()

  // Build update query dynamically
  const updates: string[] = ["updated_at = ?"]
  const params: (string | null)[] = [now]

  if (data.status !== undefined) {
    updates.push("status = ?")
    params.push(data.status)
  }
  if (data.url !== undefined) {
    updates.push("url = ?")
    params.push(data.url)
  }
  if (data.errorMessage !== undefined) {
    updates.push("error_message = ?")
    params.push(data.errorMessage)
  }

  params.push(id)

  try {
    const result = await c.env.DB.prepare(
      `UPDATE deployments SET ${updates.join(", ")} WHERE id = ?`,
    )
      .bind(...params)
      .run()

    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Deployment not found" } as ApiResponse<never>, 404)
    }

    // Record in history
    await c.env.DB.prepare(
      `INSERT INTO deployment_history (deployment_id, event_type, event_data, created_at)
       VALUES (?, 'updated', ?, ?)`,
    )
      .bind(id, JSON.stringify(data), now)
      .run()

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to update deployment:", error)
    return c.json(
      { success: false, error: "Failed to update deployment" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Delete a deployment record.
 *
 * DELETE /api/deployments/:id
 */
deploymentsRouter.delete("/:id", async (c) => {
  if (!requirePermission(c, "admin")) {
    return c.json({ success: false, error: "Admin permission required" } as ApiResponse<never>, 403)
  }

  const id = c.req.param("id")

  try {
    const result = await c.env.DB.prepare("DELETE FROM deployments WHERE id = ?")
      .bind(id)
      .run()

    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Deployment not found" } as ApiResponse<never>, 404)
    }

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to delete deployment:", error)
    return c.json(
      { success: false, error: "Failed to delete deployment" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Mark deployments as cleaned up for a PR.
 *
 * POST /api/deployments/cleanup
 */
deploymentsRouter.post("/cleanup", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const { prNumber, repository, cleanedAt } = body as {
    prNumber: number
    repository: string
    cleanedAt: string
  }

  if (!prNumber || !repository) {
    return c.json(
      { success: false, error: "prNumber and repository are required" } as ApiResponse<never>,
      400,
    )
  }

  try {
    await c.env.DB.prepare(
      `UPDATE deployments
       SET status = 'deprovisioned', updated_at = ?
       WHERE pr_number = ? AND repository = ?`,
    )
      .bind(cleanedAt ?? new Date().toISOString(), prNumber, repository)
      .run()

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to cleanup deployments:", error)
    return c.json(
      { success: false, error: "Failed to cleanup deployments" } as ApiResponse<never>,
      500,
    )
  }
})
