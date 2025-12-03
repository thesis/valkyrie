/**
 * Deploy Dashboard Worker
 *
 * This worker serves the deployment dashboard API and static assets.
 * It uses Hono for routing and D1 for data storage.
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { secureHeaders } from "hono/secure-headers"
import { Logger } from "tslog"

import { deploymentsRouter } from "./routes/deployments.ts"
import { envVarsRouter } from "./routes/env-vars.ts"
import { workersRouter } from "./routes/workers.ts"
import { previewsRouter } from "./routes/previews.ts"
import { authMiddleware } from "./middleware/auth.ts"
import { accessMiddleware } from "./middleware/access.ts"
import type { Env } from "./types.ts"

// Configure logger for Workers environment
const logger = new Logger({
  type: process.env.ENVIRONMENT === "production" ? "json" : "pretty",
  name: "deploy-dashboard",
})

// Create Hono app with typed environment
const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use("*", cors())
app.use("*", secureHeaders())

// Health check endpoint (no auth required)
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() })
})

// API routes (require authentication)
const api = new Hono<{ Bindings: Env }>()

// Apply auth middleware to API routes
api.use("*", authMiddleware)

// Mount API routers
api.route("/deployments", deploymentsRouter)
api.route("/env-vars", envVarsRouter)
api.route("/workers", workersRouter)
api.route("/previews", previewsRouter)

// Mount API under /api
app.route("/api", api)

// Protected dashboard routes (require Cloudflare Access)
app.get("/dashboard/*", accessMiddleware, async (c) => {
  // Serve static assets for the dashboard
  const url = new URL(c.req.url)
  const path = url.pathname.replace("/dashboard", "") || "/index.html"

  try {
    // @ts-expect-error - ASSETS binding is defined in wrangler.toml
    const asset = await c.env.ASSETS.fetch(new Request(`https://assets${path}`))
    return asset
  } catch {
    // Fallback to index.html for SPA routing
    // @ts-expect-error - ASSETS binding is defined in wrangler.toml
    return c.env.ASSETS.fetch(new Request("https://assets/index.html"))
  }
})

// Redirect root to dashboard
app.get("/", (c) => {
  return c.redirect("/dashboard")
})

// Serve static assets
app.get("/assets/*", async (c) => {
  const url = new URL(c.req.url)
  try {
    // @ts-expect-error - ASSETS binding is defined in wrangler.toml
    return await c.env.ASSETS.fetch(new Request(`https://assets${url.pathname}`))
  } catch {
    return c.notFound()
  }
})

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404)
})

// Error handler
app.onError((err, c) => {
  logger.error("Unhandled error:", err)
  return c.json(
    {
      error: "Internal Server Error",
      message:
        c.env.ENVIRONMENT === "production" ? undefined : err.message,
    },
    500,
  )
})

export default app
