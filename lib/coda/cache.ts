// Cache for storing API responses to reduce rate limit usage
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Aggressive caching for ID relationships (URL -> API ID mappings)
const idRelationshipCache = new Map<string, { data: { pageIds: Map<string, string>; tableIds: Map<string, string> }; timestamp: number }>()
const ID_CACHE_TTL = 15 * 60 * 1000 // 15 minutes - longer TTL since IDs rarely change

export type IdRelationships = {
	pageIds: Map<string, string>
	tableIds: Map<string, string>
}

export class CodaCache {
	static getCacheKey(endpoint: string): string {
		return `coda_api:${endpoint}`
	}

	static getFromCache<T>(key: string): T | null {
		const cached = cache.get(key)
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return cached.data as T
		}
		cache.delete(key)
		return null
	}

	static setCache(key: string, data: unknown): void {
		cache.set(key, { data, timestamp: Date.now() })
	}

	static getIdRelationshipCacheKey(docId: string): string {
		return `id_relationships:${docId}`
	}

	static getIdRelationships(docId: string): IdRelationships | null {
		const cacheKey = this.getIdRelationshipCacheKey(docId)
		const cached = idRelationshipCache.get(cacheKey)
		if (cached && Date.now() - cached.timestamp < ID_CACHE_TTL) {
			return cached.data
		}
		idRelationshipCache.delete(cacheKey)
		return null
	}

	static setIdRelationships(docId: string, pageIds: Map<string, string>, tableIds: Map<string, string>): void {
		const cacheKey = this.getIdRelationshipCacheKey(docId)
		idRelationshipCache.set(cacheKey, {
			data: { pageIds, tableIds },
			timestamp: Date.now()
		})
	}

	static invalidateIdRelationships(docId: string): void {
		const cacheKey = this.getIdRelationshipCacheKey(docId)
		idRelationshipCache.delete(cacheKey)
	}
}