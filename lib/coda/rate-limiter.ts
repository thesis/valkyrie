import axios from "axios"
import { Log } from "hubot"

// Rate limiting state
const rateLimitState = {
	backoffUntil: 0,
	retryAfter: 0
}

// Rate limit error interface
export type RateLimitError = Error & {
	isRateLimit: true
	retryAfter: number
}

// Type guard for rate limit errors
export function isRateLimitError(error: unknown): error is RateLimitError {
	return error instanceof Error && 'isRateLimit' in error && (error as RateLimitError).isRateLimit === true
}

/**
 * Rate limiting utility that handles 429 responses with retry-after headers
 */
export default class RateLimiter {
	static async executeWithBackoff<T>(operation: () => Promise<T>, logger: Log): Promise<T> {
		// Check if we're in a backoff period
		const now = Date.now()
		if (now < rateLimitState.backoffUntil) {
			const waitTime = rateLimitState.backoffUntil - now
			logger.info(`Rate limited, waiting ${Math.ceil(waitTime / 1000)}s before retry`)
			await new Promise(resolve => setTimeout(resolve, waitTime))
		}

		try {
			return await operation()
		} catch (error) {
			if (axios.isAxiosError(error) && error.response?.status === 429) {
				// Parse retry-after header (can be in seconds or HTTP date)
				const retryAfterHeader = error.response.headers['retry-after']
				let retryAfterMs = 60000 // Default 60s if no header

				if (retryAfterHeader) {
					const retryAfterNum = Number(retryAfterHeader)
					if (!Number.isNaN(retryAfterNum)) {
						// Seconds format
						retryAfterMs = retryAfterNum * 1000
					} else {
						// HTTP date format
						const retryAfterDate = new Date(retryAfterHeader)
						if (!Number.isNaN(retryAfterDate.getTime())) {
							retryAfterMs = Math.max(0, retryAfterDate.getTime() - Date.now())
						}
					}
				}

				// Set global backoff state
				rateLimitState.backoffUntil = Date.now() + retryAfterMs
				rateLimitState.retryAfter = retryAfterMs

				logger.warning(`Coda API rate limited, backing off for ${Math.ceil(retryAfterMs / 1000)}s`)
				
				// Throw a custom error that can be caught and handled
				const rateLimitError = new Error(`Rate limited, retry after ${Math.ceil(retryAfterMs / 1000)}s`) as RateLimitError
				rateLimitError.isRateLimit = true
				rateLimitError.retryAfter = retryAfterMs
				throw rateLimitError
			}
			throw error
		}
	}
}