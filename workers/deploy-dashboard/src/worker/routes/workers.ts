/**
 * Workers Registry API Routes
 *
 * Manage the registry of known workers and their configurations.
 */

import { Hono } from "hono"
import type { Env, WorkerRecord, ApiResponse } from "../types.ts"
import { RegisterWorkerRequest } from "../types.ts"
import { requirePermission } from "../middleware/auth.ts"

export const workersRouter = new Hono<{ Bindings: Env }>()

/**
 * List all registered workers.
 *
 * GET /api/workers
 */
workersRouter.get("/", async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT * FROM workers ORDER BY name",
  ).all<{
    name: string
    path: string
    environments: string
    routes: string
    preview_enabled: number
    created_at: string
    updated_at: string
  }>()

  // Transform the results to parse JSON fields
  const workers = (results.results ?? []).map((w) => ({
    name: w.name,
    path: w.path,
    environments: JSON.parse(w.environments) as string[],
    routes: JSON.parse(w.routes) as Record<string, string>,
    previewEnabled: w.preview_enabled === 1,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }))

  return c.json({
    success: true,
    data: workers,
  } as ApiResponse<typeof workers>)
})

/**
 * Get a single worker by name.
 *
 * GET /api/workers/:name
 */
workersRouter.get("/:name", async (c) => {
  const name = c.req.param("name")

  const worker = await c.env.DB.prepare("SELECT * FROM workers WHERE name = ?")
    .bind(name)
    .first<{
      name: string
      path: string
      environments: string
      routes: string
      preview_enabled: number
      created_at: string
      updated_at: string
    }>()

  if (!worker) {
    return c.json({ success: false, error: "Worker not found" } as ApiResponse<never>, 404)
  }

  // Get recent deployments for this worker
  const deployments = await c.env.DB.prepare(
    `SELECT * FROM deployments
     WHERE worker_name = ?
     ORDER BY deployed_at DESC
     LIMIT 10`,
  )
    .bind(name)
    .all()

  return c.json({
    success: true,
    data: {
      name: worker.name,
      path: worker.path,
      environments: JSON.parse(worker.environments) as string[],
      routes: JSON.parse(worker.routes) as Record<string, string>,
      previewEnabled: worker.preview_enabled === 1,
      createdAt: worker.created_at,
      updatedAt: worker.updated_at,
      recentDeployments: deployments.results ?? [],
    },
  } as ApiResponse<{
    name: string
    path: string
    environments: string[]
    routes: Record<string, string>
    previewEnabled: boolean
    createdAt: string
    updatedAt: string
    recentDeployments: unknown[]
  }>)
})

/**
 * Register or update a worker.
 *
 * POST /api/workers
 */
workersRouter.post("/", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const parsed = RegisterWorkerRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data
  const now = new Date().toISOString()

  try {
    // Upsert the worker
    await c.env.DB.prepare(
      `INSERT INTO workers (name, path, environments, routes, preview_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         path = excluded.path,
         environments = excluded.environments,
         routes = excluded.routes,
         preview_enabled = excluded.preview_enabled,
         updated_at = excluded.updated_at`,
    )
      .bind(
        data.name,
        data.path,
        JSON.stringify(data.environments),
        JSON.stringify(data.routes),
        data.previewEnabled ? 1 : 0,
        now,
        now,
      )
      .run()

    return c.json({
      success: true,
      data: { name: data.name },
    } as ApiResponse<{ name: string }>, 201)
  } catch (error) {
    console.error("Failed to register worker:", error)
    return c.json(
      { success: false, error: "Failed to register worker" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Delete a worker from the registry.
 *
 * DELETE /api/workers/:name
 */
workersRouter.delete("/:name", async (c) => {
  if (!requirePermission(c, "admin")) {
    return c.json({ success: false, error: "Admin permission required" } as ApiResponse<never>, 403)
  }

  const name = c.req.param("name")

  try {
    const result = await c.env.DB.prepare("DELETE FROM workers WHERE name = ?")
      .bind(name)
      .run()

    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Worker not found" } as ApiResponse<never>, 404)
    }

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to delete worker:", error)
    return c.json(
      { success: false, error: "Failed to delete worker" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Sync workers from configuration file.
 *
 * POST /api/workers/sync
 */
workersRouter.post("/sync", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = (await c.req.json()) as {
    workers: Array<{
      name: string
      path: string
      environments: string[]
      routes: Record<string, string>
      previewEnabled?: boolean
    }>
  }

  if (!body.workers || !Array.isArray(body.workers)) {
    return c.json(
      { success: false, error: "workers array is required" } as ApiResponse<never>,
      400,
    )
  }

  const now = new Date().toISOString()
  let synced = 0

  try {
    for (const worker of body.workers) {
      await c.env.DB.prepare(
        `INSERT INTO workers (name, path, environments, routes, preview_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           path = excluded.path,
           environments = excluded.environments,
           routes = excluded.routes,
           preview_enabled = excluded.preview_enabled,
           updated_at = excluded.updated_at`,
      )
        .bind(
          worker.name,
          worker.path,
          JSON.stringify(worker.environments),
          JSON.stringify(worker.routes),
          worker.previewEnabled !== false ? 1 : 0,
          now,
          now,
        )
        .run()
      synced++
    }

    return c.json({
      success: true,
      data: { synced },
    } as ApiResponse<{ synced: number }>)
  } catch (error) {
    console.error("Failed to sync workers:", error)
    return c.json(
      { success: false, error: "Failed to sync workers" } as ApiResponse<never>,
      500,
    )
  }
})
