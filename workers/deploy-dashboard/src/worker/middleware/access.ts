/**
 * Cloudflare Access Middleware
 *
 * Validates Cloudflare Access JWT tokens for protected routes.
 * This ensures only authenticated users can access the dashboard UI.
 */

import { createMiddleware } from "hono/factory"
import type { Env } from "../types.ts"

type AccessJWTPayload = {
  aud: string[]
  email: string
  exp: number
  iat: number
  nbf: number
  iss: string
  type: string
  identity_nonce: string
  sub: string
  country: string
}

/**
 * Fetches Cloudflare Access public keys for JWT verification.
 */
async function getAccessPublicKeys(teamDomain: string): Promise<JsonWebKey[]> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`
  const response = await fetch(certsUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch Access certs: ${response.status}`)
  }

  const data = (await response.json()) as { keys: JsonWebKey[] }
  return data.keys
}

/**
 * Verifies a Cloudflare Access JWT token.
 */
async function verifyAccessJWT(
  token: string,
  teamDomain: string,
  audience: string,
): Promise<AccessJWTPayload | null> {
  try {
    const keys = await getAccessPublicKeys(teamDomain)

    // Parse the JWT header to find the key ID
    const [headerB64] = token.split(".")
    if (!headerB64) return null

    const header = JSON.parse(atob(headerB64)) as { kid: string; alg: string }
    const key = keys.find((k) => k.kid === header.kid)

    if (!key) {
      console.error("No matching key found for JWT")
      return null
    }

    // Import the public key
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    )

    // Verify the signature
    const [, payloadB64, signatureB64] = token.split(".")
    if (!payloadB64 || !signatureB64) return null

    const signatureInput = new TextEncoder().encode(
      `${headerB64}.${payloadB64}`,
    )
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    )

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      signatureInput,
    )

    if (!isValid) {
      console.error("JWT signature verification failed")
      return null
    }

    // Decode and validate the payload
    const payload = JSON.parse(atob(payloadB64)) as AccessJWTPayload

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      console.error("JWT has expired")
      return null
    }

    // Check audience
    if (!payload.aud.includes(audience)) {
      console.error("JWT audience mismatch")
      return null
    }

    return payload
  } catch (error) {
    console.error("JWT verification error:", error)
    return null
  }
}

/**
 * Cloudflare Access middleware for protecting dashboard routes.
 *
 * Checks for the CF_Authorization cookie and validates the JWT
 * against Cloudflare Access.
 */
export const accessMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN
    const audience = c.env.CF_ACCESS_AUD

    // Skip validation if Access is not configured
    if (!teamDomain || !audience) {
      console.warn("Cloudflare Access not configured - skipping validation")
      await next()
      return
    }

    // Get the Access JWT from cookie or header
    const cookie = c.req.header("Cookie") ?? ""
    const jwtMatch = cookie.match(/CF_Authorization=([^;]+)/)
    const jwt =
      jwtMatch?.[1] ?? c.req.header("Cf-Access-Jwt-Assertion") ?? ""

    if (!jwt) {
      // Redirect to Access login
      const loginUrl = `https://${teamDomain}/cdn-cgi/access/login?kid=${audience}&redirect_url=${encodeURIComponent(c.req.url)}`
      return c.redirect(loginUrl, 302)
    }

    // Verify the JWT
    const payload = await verifyAccessJWT(jwt, teamDomain, audience)

    if (!payload) {
      return c.json({ error: "Invalid or expired Access token" }, 401)
    }

    // Store user info in context
    c.set("accessUser", {
      email: payload.email,
      sub: payload.sub,
      country: payload.country,
    })

    await next()
  },
)

/**
 * Gets the authenticated Access user from context.
 */
export function getAccessUser(c: {
  get: (key: string) => unknown
}): { email: string; sub: string; country: string } | undefined {
  return c.get("accessUser") as
    | { email: string; sub: string; country: string }
    | undefined
}
