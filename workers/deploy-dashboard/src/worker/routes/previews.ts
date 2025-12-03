/**
 * Preview Deployments API Routes
 *
 * Manage PR preview deployments and their subdomains.
 */

import { Hono } from "hono"
import type { Env, PreviewRecord, ApiResponse, PaginatedResponse } from "../types.ts"
import { CreatePreviewRequest, CleanupPreviewRequest } from "../types.ts"
import { requirePermission } from "../middleware/auth.ts"

export const previewsRouter = new Hono<{ Bindings: Env }>()

/**
 * List all preview deployments with pagination.
 *
 * GET /api/previews
 * Query params:
 *   - page: Page number (default: 1)
 *   - pageSize: Items per page (default: 20, max: 100)
 *   - status: Filter by status ('active', 'cleaned', or 'all')
 *   - repository: Filter by repository
 */
previewsRouter.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20))
  const status = c.req.query("status") ?? "active"
  const repository = c.req.query("repository")

  const offset = (page - 1) * pageSize

  // Build query with filters
  let whereClause = "1=1"
  const params: (string | number)[] = []

  if (status !== "all") {
    whereClause += " AND status = ?"
    params.push(status)
  }
  if (repository) {
    whereClause += " AND repository = ?"
    params.push(repository)
  }

  // Get total count
  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM preview_deployments WHERE ${whereClause}`,
  )
    .bind(...params)
    .first<{ count: number }>()

  const total = countResult?.count ?? 0

  // Get paginated results
  const results = await c.env.DB.prepare(
    `SELECT * FROM preview_deployments
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<PreviewRecord>()

  const response: PaginatedResponse<PreviewRecord> = {
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
 * Get a single preview deployment by PR number.
 *
 * GET /api/previews/:prNumber
 */
previewsRouter.get("/:prNumber", async (c) => {
  const prNumber = Number(c.req.param("prNumber"))

  if (Number.isNaN(prNumber)) {
    return c.json({ success: false, error: "Invalid PR number" } as ApiResponse<never>, 400)
  }

  const preview = await c.env.DB.prepare(
    "SELECT * FROM preview_deployments WHERE pr_number = ?",
  )
    .bind(prNumber)
    .first<PreviewRecord>()

  if (!preview) {
    return c.json({ success: false, error: "Preview not found" } as ApiResponse<never>, 404)
  }

  // Get all workers deployed for this preview
  const deployments = await c.env.DB.prepare(
    `SELECT * FROM deployments
     WHERE pr_number = ? AND environment = 'preview'
     ORDER BY deployed_at DESC`,
  )
    .bind(prNumber)
    .all()

  return c.json({
    success: true,
    data: {
      ...preview,
      deployments: deployments.results ?? [],
    },
  } as ApiResponse<PreviewRecord & { deployments: unknown[] }>)
})

/**
 * Create or update a preview deployment record.
 *
 * POST /api/previews
 */
previewsRouter.post("/", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const parsed = CreatePreviewRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data
  const now = new Date().toISOString()

  try {
    // Upsert the preview deployment
    await c.env.DB.prepare(
      `INSERT INTO preview_deployments (pr_number, subdomain, dns_record_id, repository, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON CONFLICT(pr_number) DO UPDATE SET
         subdomain = excluded.subdomain,
         dns_record_id = excluded.dns_record_id,
         status = 'active',
         cleaned_at = NULL`,
    )
      .bind(
        data.prNumber,
        data.subdomain,
        data.dnsRecordId ?? null,
        data.repository,
        now,
      )
      .run()

    return c.json({
      success: true,
      data: { prNumber: data.prNumber },
    } as ApiResponse<{ prNumber: number }>, 201)
  } catch (error) {
    console.error("Failed to create preview:", error)
    return c.json(
      { success: false, error: "Failed to create preview" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Mark a preview deployment as cleaned up.
 *
 * POST /api/previews/cleanup
 */
previewsRouter.post("/cleanup", async (c) => {
  if (!requirePermission(c, "write")) {
    return c.json({ success: false, error: "Write permission required" } as ApiResponse<never>, 403)
  }

  const body = await c.req.json()
  const parsed = CleanupPreviewRequest.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.message } as ApiResponse<never>,
      400,
    )
  }

  const data = parsed.data

  try {
    // Update preview deployment status
    await c.env.DB.prepare(
      `UPDATE preview_deployments
       SET status = 'cleaned', cleaned_at = ?
       WHERE pr_number = ? AND repository = ?`,
    )
      .bind(data.cleanedAt, data.prNumber, data.repository)
      .run()

    // Also update associated deployments
    await c.env.DB.prepare(
      `UPDATE deployments
       SET status = 'deprovisioned', updated_at = ?
       WHERE pr_number = ? AND repository = ? AND environment = 'preview'`,
    )
      .bind(data.cleanedAt, data.prNumber, data.repository)
      .run()

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to cleanup preview:", error)
    return c.json(
      { success: false, error: "Failed to cleanup preview" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Delete a preview deployment record.
 *
 * DELETE /api/previews/:prNumber
 */
previewsRouter.delete("/:prNumber", async (c) => {
  if (!requirePermission(c, "admin")) {
    return c.json({ success: false, error: "Admin permission required" } as ApiResponse<never>, 403)
  }

  const prNumber = Number(c.req.param("prNumber"))

  if (Number.isNaN(prNumber)) {
    return c.json({ success: false, error: "Invalid PR number" } as ApiResponse<never>, 400)
  }

  try {
    const result = await c.env.DB.prepare(
      "DELETE FROM preview_deployments WHERE pr_number = ?",
    )
      .bind(prNumber)
      .run()

    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Preview not found" } as ApiResponse<never>, 404)
    }

    return c.json({ success: true } as ApiResponse<never>)
  } catch (error) {
    console.error("Failed to delete preview:", error)
    return c.json(
      { success: false, error: "Failed to delete preview" } as ApiResponse<never>,
      500,
    )
  }
})

/**
 * Get preview deployment statistics.
 *
 * GET /api/previews/stats
 */
previewsRouter.get("/stats", async (c) => {
  const repository = c.req.query("repository")

  let whereClause = ""
  const params: string[] = []

  if (repository) {
    whereClause = "WHERE repository = ?"
    params.push(repository)
  }

  const stats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
       COUNT(CASE WHEN status = 'cleaned' THEN 1 END) as cleaned,
       MIN(created_at) as oldest_active_date
     FROM preview_deployments
     ${whereClause}`,
  )
    .bind(...params)
    .first<{
      total: number
      active: number
      cleaned: number
      oldest_active_date: string | null
    }>()

  return c.json({
    success: true,
    data: stats,
  } as ApiResponse<typeof stats>)
})
