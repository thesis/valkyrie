import axios, { AxiosInstance } from "axios"
import { Log } from "hubot"
import { CodaCache } from "./cache.ts"
import RateLimiter from "./rate-limiter.ts"

export type CodaDocument = {
	id: string
	name: string
	owner: string
	ownerName: string
	browserLink: string
	createdAt: string
	updatedAt: string
	icon?: {
		name?: string
		type?: string
		browserLink?: string
	}
	published?: {
		description?: string
		imageLink?: string
	}
	workspace: {
		name: string
		browserLink: string
	}
}

export type CodaPage = {
	id: string
	name: string
	subtitle?: string
	browserLink: string
	contentTypes: string[]
	icon?: {
		name?: string
		type?: string
		browserLink?: string
	}
	image?: {
		name?: string
		type?: string
		browserLink?: string
	}
	parent?: {
		name: string
	}
	createdAt: string
	updatedAt: string
}

export type CodaSection = {
	id: string
	name: string
	browserLink: string
	parent: {
		name: string
	}
}

export type CodaTable = {
	id: string
	name: string
	browserLink: string
	parent: {
		id: string
		name: string
		href: string
		browserLink?: string
	}
	columns: Array<{
		id: string
		name: string
		type: string
	}>
	createdAt: string
	updatedAt: string
}

export type CodaResolvedResource = {
	id: string
	type: "doc" | "table" | "page" | "column" | "row" | "control" | "section" | "folder"
	href: string
	browserLink: string
	name: string
	// Additional properties based on type
	doc?: CodaDocument
	table?: CodaTable  
	page?: CodaPage
	section?: CodaSection
}

// No-op logger for when none is provided
const noopLogLevel = Object.assign(() => {
	// intentionally empty
}, {
	disable: () => {
		// intentionally empty
	},
	enable: () => {
		// intentionally empty
	}
})

const noopLogger: Log = Object.assign(() => {
	// intentionally empty
}, {
	get: () => noopLogger,
	debug: noopLogLevel,
	info: noopLogLevel,
	notice: noopLogLevel,
	warning: noopLogLevel,
	error: noopLogLevel
})

export default class CodaApiClient {
	private client: AxiosInstance

	constructor(apiToken: string) {
		this.client = axios.create({
			baseURL: "https://coda.io/apis/v1",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
			timeout: 10000,
		})
	}


	/**
	 * Resolves a browser link to get basic metadata about the referenced resource
	 */
	async resolveBrowserLink(url: string, logger?: Log): Promise<CodaResolvedResource> {
		const cacheKey = CodaCache.getCacheKey(`resolveBrowserLink:${url}`)
		const cached = CodaCache.getFromCache<CodaResolvedResource>(cacheKey)
		if (cached) return cached

		const response = await RateLimiter.executeWithBackoff(
			() => this.client.get(`/resolveBrowserLink`, {
				params: { url }
			}),
			logger || noopLogger
		)
		const data = response.data?.resource as CodaResolvedResource
		CodaCache.setCache(cacheKey, data)
		return data
	}

	/**
	 * Resolves a browser link and fetches complete resource metadata
	 */
	async resolveBrowserLinkResource(url: string, logger?: Log): Promise<CodaResolvedResource> {
		const cacheKey = CodaCache.getCacheKey(`resolveBrowserLinkResource:${url}`)
		const cached = CodaCache.getFromCache<CodaResolvedResource>(cacheKey)
		if (cached) return cached

		// First, resolve the basic resource info
		const basicResource = await this.resolveBrowserLink(url, logger)
		
		// Initialize the complete resource with basic info
		const completeResource: CodaResolvedResource = {
			...basicResource
		}

		// Extract document ID from href for non-doc resources
		let docId: string | undefined
		if (basicResource.type !== "doc") {
			const docMatch = basicResource.href.match(/\/docs\/([^/]+)/)
			if (!docMatch) {
				throw new Error(`Cannot extract document ID from href: ${basicResource.href}`)
			}
			docId = docMatch[1]
		}

		// Fetch additional data based on resource type using the href directly
		try {
			if (basicResource.type === "doc") {
				// For doc resources, fetch the complete document data using the href
				completeResource.doc = await this.getResourceByHref(basicResource.href, logger) as CodaDocument
			} else if (basicResource.type === "page") {
				// For page resources, fetch both the page and its parent document
				completeResource.page = await this.getResourceByHref(basicResource.href, logger) as CodaPage
				if (docId) {
					completeResource.doc = await this.getDocument(docId, logger)
				}
			} else if (basicResource.type === "section") {
				// For section resources, fetch both the section and its parent document
				completeResource.section = await this.getResourceByHref(basicResource.href, logger) as CodaSection
				if (docId) {
					completeResource.doc = await this.getDocument(docId, logger)
				}
			} else if (basicResource.type === "table") {
				// For table resources, fetch the table, its parent document, and optionally parent page
				completeResource.table = await this.getResourceByHref(basicResource.href, logger) as CodaTable
				if (docId) {
					completeResource.doc = await this.getDocument(docId, logger)
				}
				
				// For tables, also fetch the parent page if available
				const table = completeResource.table
				if (table?.parent?.href) {
					try {
						completeResource.page = await this.getResourceByHref(table.parent.href, logger) as CodaPage
					} catch (error) {
						logger?.warning(`Failed to fetch parent page for table ${table.name}:`, error)
					}
				}
			}
		} catch (error) {
			logger?.warning(`Failed to fetch additional data for ${basicResource.type} ${basicResource.id}:`, error)
			// Continue with basic resource data even if additional fetch fails
		}

		CodaCache.setCache(cacheKey, completeResource)
		return completeResource
	}

	/**
	 * Fetches a resource using its href directly
	 */
	async getResourceByHref(href: string, logger?: Log): Promise<CodaDocument | CodaPage | CodaSection | CodaTable> {
		const cacheKey = CodaCache.getCacheKey(`href:${href}`)
		const cached = CodaCache.getFromCache<CodaDocument | CodaPage | CodaSection | CodaTable>(cacheKey)
		if (cached) return cached

		// For table hrefs, also fetch columns if it's a table endpoint
		if (href.includes('/tables/')) {
			const [tableResponse, columnsResponse] = await Promise.all([
				RateLimiter.executeWithBackoff(
					() => this.client.get(href),
					logger || noopLogger
				),
				RateLimiter.executeWithBackoff(
					() => this.client.get(`${href}/columns`),
					logger || noopLogger
				),
			])

			const tableData = tableResponse.data
			const columnsData = columnsResponse.data

			const data = {
				...tableData,
				columns: columnsData.items || [],
			}

			CodaCache.setCache(cacheKey, data)
			return data
		} else {
			// For non-table resources, just fetch the resource directly
			const response = await RateLimiter.executeWithBackoff(
				() => this.client.get(href),
				logger || noopLogger
			)
			const data = response.data
			CodaCache.setCache(cacheKey, data)
			return data
		}
	}


	async getDocument(docId: string, logger?: Log): Promise<CodaDocument> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}`)
		const cached = CodaCache.getFromCache<CodaDocument>(cacheKey)
		if (cached) return cached

		const response = await RateLimiter.executeWithBackoff(
			() => this.client.get(`/docs/${docId}`),
			logger || noopLogger
		)
		const data = response.data as CodaDocument
		CodaCache.setCache(cacheKey, data)
		return data
	}

	async getPage(docId: string, pageId: string, logger?: Log): Promise<CodaPage> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}/pages/${pageId}`)
		const cached = CodaCache.getFromCache<CodaPage>(cacheKey)
		if (cached) return cached

		const response = await RateLimiter.executeWithBackoff(
			() => this.client.get(`/docs/${docId}/pages/${pageId}`),
			logger || noopLogger
		)
		const data = response.data as CodaPage
		CodaCache.setCache(cacheKey, data)
		return data
	}

	async getSection(
		docId: string,
		sectionId: string,
		logger?: Log,
	): Promise<CodaSection> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}/sections/${sectionId}`)
		const cached = CodaCache.getFromCache<CodaSection>(cacheKey)
		if (cached) return cached

		const response = await RateLimiter.executeWithBackoff(
			() => this.client.get(`/docs/${docId}/sections/${sectionId}`),
			logger || noopLogger
		)
		const data = response.data as CodaSection
		CodaCache.setCache(cacheKey, data)
		return data
	}

	async getTable(docId: string, tableId: string, logger?: Log): Promise<CodaTable> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}/tables/${tableId}`)
		const cached = CodaCache.getFromCache<CodaTable>(cacheKey)
		if (cached) return cached

		const [tableResponse, columnsResponse] = await Promise.all([
			RateLimiter.executeWithBackoff(
				() => this.client.get(`/docs/${docId}/tables/${tableId}`),
				logger || noopLogger
			),
			RateLimiter.executeWithBackoff(
				() => this.client.get(`/docs/${docId}/tables/${tableId}/columns`),
				logger || noopLogger
			),
		])

		const tableData = tableResponse.data
		const columnsData = columnsResponse.data

		const data: CodaTable = {
			...tableData,
				columns: columnsData.items || [],
		}

		CodaCache.setCache(cacheKey, data)
		return data
	}

	async getPages(docId: string): Promise<CodaPage[]> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}/pages`)
		const cached = CodaCache.getFromCache<CodaPage[]>(cacheKey)
		if (cached) return cached

		const allPages: CodaPage[] = []
		let nextPageToken: string | undefined
		let pageCount = 0

		do {
			pageCount++
			const params = new URLSearchParams()
			if (nextPageToken) {
				params.append('pageToken', nextPageToken)
			}

			const url = params.toString() ? `/docs/${docId}/pages?${params.toString()}` : `/docs/${docId}/pages`
			const response = await RateLimiter.executeWithBackoff(
				() => this.client.get(url),
				noopLogger
			)
			const responseData = response.data

			// Add pages from this response to our collection
			if (responseData.items && Array.isArray(responseData.items)) {
				allPages.push(...responseData.items)
			}

			// Check if there are more pages to fetch
			nextPageToken = responseData.nextPageToken

			// Safety check to prevent infinite loops
			if (pageCount > 100) {
				throw new Error(`Too many pages fetched (${pageCount}) for document ${docId} - possible infinite loop`)
			}
		} while (nextPageToken)

		// Note: We could add logging here for pagination debugging if we had logger access
		// For now, we rely on the resolvePageByUrl method to log when page resolution fails

		CodaCache.setCache(cacheKey, allPages)
		return allPages
	}

	async getTables(docId: string): Promise<CodaTable[]> {
		const cacheKey = CodaCache.getCacheKey(`docs/${docId}/tables`)
		const cached = CodaCache.getFromCache<CodaTable[]>(cacheKey)
		if (cached) return cached

		const allTables: CodaTable[] = []
		let nextPageToken: string | undefined
		let pageCount = 0

		do {
			pageCount++
			const params = new URLSearchParams()
			if (nextPageToken) {
				params.append('pageToken', nextPageToken)
			}

			const url = params.toString() ? `/docs/${docId}/tables?${params.toString()}` : `/docs/${docId}/tables`
			const response = await RateLimiter.executeWithBackoff(
				() => this.client.get(url),
				noopLogger
			)
			const responseData = response.data

			// Add tables from this response to our collection
			if (responseData.items && Array.isArray(responseData.items)) {
				// Don't fetch columns during listing - that's wasteful
				// Columns will be fetched only when we need specific table details via getTable()
				const tablesWithoutColumns = responseData.items.map((table: Partial<CodaTable>) => ({
					...table,
					columns: [], // Empty columns array - will be populated when specific table is requested
				}))
				allTables.push(...tablesWithoutColumns)
			}

			// Check if there are more tables to fetch
			nextPageToken = responseData.nextPageToken

			// Safety check to prevent infinite loops
			if (pageCount > 100) {
				throw new Error(`Too many pages fetched (${pageCount}) for tables in document ${docId} - possible infinite loop`)
			}
		} while (nextPageToken)

		CodaCache.setCache(cacheKey, allTables)
		return allTables
	}

}
