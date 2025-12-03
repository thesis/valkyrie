/**
 * Example Cloudflare Worker
 *
 * This is a template worker demonstrating the structure and patterns
 * used in this deployment system. Copy this directory to create a new worker.
 *
 * Features demonstrated:
 * - Hono routing framework
 * - Environment variable access
 * - tslog for structured logging
 * - Zod for request validation
 * - CORS handling
 * - Error handling
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { secureHeaders } from "hono/secure-headers"
import { Logger } from "tslog"
import { z } from "zod"

/**
 * Worker environment bindings.
 * Add your environment variables and bindings here.
 */
type Env = {
  ENVIRONMENT: string
  LOG_LEVEL: string
  // Add your custom environment variables here:
  // API_KEY: string
  // DATABASE_URL: string
}

// Configure logger based on environment
function createLogger(env: Env) {
  return new Logger({
    type: env.ENVIRONMENT === "production" ? "json" : "pretty",
    name: "example-worker",
    minLevel: env.LOG_LEVEL === "debug" ? 0 : 2,
  })
}

// Create Hono app with typed environment
const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use("*", cors())
app.use("*", secureHeaders())

/**
 * Health check endpoint.
 * Always returns 200 OK - useful for monitoring and load balancers.
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  })
})

/**
 * Root endpoint.
 * Returns basic information about the worker.
 */
app.get("/", (c) => {
  const logger = createLogger(c.env)
  logger.info("Root endpoint accessed")

  return c.json({
    name: "example-worker",
    version: "1.0.0",
    environment: c.env.ENVIRONMENT,
    message: "Welcome to the Example Worker!",
  })
})

/**
 * Example GET endpoint with query parameters.
 */
app.get("/echo", (c) => {
  const message = c.req.query("message") ?? "Hello, World!"
  const logger = createLogger(c.env)

  logger.debug("Echo endpoint called", { message })

  return c.json({
    echo: message,
    timestamp: new Date().toISOString(),
  })
})

/**
 * Example POST endpoint with request body validation.
 */
const CreateItemSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).max(10).optional(),
})

app.post("/items", async (c) => {
  const logger = createLogger(c.env)

  try {
    const body = await c.req.json()
    const parsed = CreateItemSchema.safeParse(body)

    if (!parsed.success) {
      logger.warn("Invalid request body", {
        errors: parsed.error.errors,
      })
      return c.json(
        {
          error: "Invalid request body",
          details: parsed.error.errors,
        },
        400,
      )
    }

    const item = parsed.data
    logger.info("Item created", { name: item.name })

    // In a real worker, you would save this to a database
    return c.json(
      {
        id: crypto.randomUUID(),
        ...item,
        createdAt: new Date().toISOString(),
      },
      201,
    )
  } catch (error) {
    logger.error("Failed to create item", { error })
    return c.json({ error: "Internal server error" }, 500)
  }
})

/**
 * Example endpoint demonstrating environment variable usage.
 */
app.get("/config", (c) => {
  // Only show non-sensitive configuration in non-production environments
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ message: "Configuration hidden in production" })
  }

  return c.json({
    environment: c.env.ENVIRONMENT,
    logLevel: c.env.LOG_LEVEL,
    // Add other non-sensitive config here
  })
})

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      path: c.req.path,
    },
    404,
  )
})

// Error handler
app.onError((err, c) => {
  const logger = createLogger(c.env)
  logger.error("Unhandled error", { error: err.message, stack: err.stack })

  return c.json(
    {
      error: "Internal Server Error",
      // Only show details in non-production
      ...(c.env.ENVIRONMENT !== "production" && { message: err.message }),
    },
    500,
  )
})

export default app
