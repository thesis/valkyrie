/**
 * API Authentication Middleware
 *
 * Authenticates API requests using Bearer tokens.
 * Tokens are validated against hashed keys stored in D1.
 */

import { createMiddleware } from "hono/factory"
import type { Env } from "../types.ts"

/**
 * Simple hash function for API key validation.
 * In production, use a proper cryptographic hash.
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Auth middleware for API routes.
 *
 * Checks for Bearer token in Authorization header and validates
 * against stored API keys.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization")

    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401)
    }

    const [scheme, token] = authHeader.split(" ")

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return c.json({ error: "Invalid Authorization header format" }, 401)
    }

    // Check against environment variable first (for simple setups)
    if (c.env.API_KEY_HASH) {
      const tokenHash = await hashApiKey(token)
      if (tokenHash === c.env.API_KEY_HASH) {
        await next()
        return
      }
    }

    // Check against D1 stored keys
    try {
      const tokenHash = await hashApiKey(token)
      const result = await c.env.DB.prepare(
        `SELECT id, permissions FROM api_keys
         WHERE key_hash = ? AND is_active = 1
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
        .bind(tokenHash)
        .first<{ id: number; permissions: string }>()

      if (!result) {
        return c.json({ error: "Invalid API key" }, 401)
      }

      // Update last used timestamp
      await c.env.DB.prepare(
        `UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`,
      )
        .bind(result.id)
        .run()

      // Store permissions in context for route handlers
      c.set("permissions", JSON.parse(result.permissions) as string[])

      await next()
    } catch (error) {
      console.error("Auth error:", error)
      return c.json({ error: "Authentication failed" }, 500)
    }
  },
)

/**
 * Permission check helper.
 * Use in route handlers to verify the API key has required permissions.
 */
export function requirePermission(
  c: { get: (key: string) => unknown },
  permission: string,
): boolean {
  const permissions = c.get("permissions") as string[] | undefined
  return permissions?.includes(permission) ?? false
}
