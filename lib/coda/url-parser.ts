export type CodaLinkData = {
	docId: string
	pageId?: string
	sectionId?: string
	tableId?: string
	originalUrl: string
	type: "document" | "page" | "section" | "table"
	// Names extracted from URL for better placeholder embeds
	pageName?: string
	tableName?: string
}

/**
 * Extracts the document, page, and table ID components from a Coda URL.
 * This handles URLs with user-readable slugs by focusing on just the ID parts.
 * 
 * Examples:
 * - https://coda.io/d/_dAbC123/My-Page-Name_suXyZ789 -> { docId: 'AbC123', pageId: 'XyZ789' }
 * - https://coda.io/d/_dAbC123 -> { docId: 'AbC123' }
 * - https://coda.io/d/_dAbC123/page#Table-Name_tuDef456 -> { docId: 'AbC123', tableId: 'Def456' }
 */
export function extractUrlIds(url: string): { docId?: string; pageId?: string; tableId?: string } {
	// Match the document part first
	const docMatch = url.match(/\/d\/_d([^/?#]+)/)
	if (!docMatch) {
		return {}
	}

	const docId = docMatch[1]
	
	// Look for page ID after _su
	const pageMatch = url.match(/_su([^/?#]+)/)
	const pageId = pageMatch ? pageMatch[1] : undefined
	
	// Look for table ID in different formats:
	// 1. User URLs: _tu (in hash) or _t (in path) - e.g., #Current-OKR-Status_tunKXZE- or _tKXZE-
	// 2. API browserLink: _tutable- prefix in hash - e.g., #_tutable-Ozj5nKXZE-
	const tableMatch = url.match(/_tu([^/?#&]+)/) || url.match(/_t([^/?#]+)/)
	let tableId = tableMatch ? tableMatch[1] : undefined
	
	// If no match with user format, try API browserLink format
	if (!tableId) {
		const apiBrowserLinkMatch = url.match(/#_tutable-([^/?#&]+)/)
		tableId = apiBrowserLinkMatch ? apiBrowserLinkMatch[1] : undefined
	}
	
	return { docId, pageId, tableId }
}

/**
 * Checks if two Coda URLs refer to the same resource by comparing their ID components.
 * This ignores user-readable slugs and focuses on the actual IDs.
 * 
 * Special handling for tables: API browserLink format vs user URL format may have
 * different table IDs that represent the same resource. For tables, we need to 
 * match by table ID patterns and potentially ignore page differences.
 */
export function urlsMatchResource(url1: string, url2: string): boolean {
	const ids1 = extractUrlIds(url1)
	const ids2 = extractUrlIds(url2)
	
	// Both must have doc IDs and they must match
	if (!ids1.docId || !ids2.docId || ids1.docId !== ids2.docId) {
		return false
	}
	
	// If both have table IDs, check for table match
	if (ids1.tableId && ids2.tableId) {
		// For tables, the API browserLink format may not include page info,
		// so we focus on table ID matching. The table IDs might be different
		// but represent the same table (e.g., "nKXZE" vs "Ozj5nKXZE")
		
		// Check if one ID is a suffix of the other (common pattern)
		const table1 = ids1.tableId
		const table2 = ids2.tableId
		
		if (table1 === table2) {
			return true // Exact match
		}
		
		// Check if one is a suffix of the other (API vs user URL pattern)
		if (table1.endsWith(table2) || table2.endsWith(table1)) {
			return true
		}
		
		// If no table ID match patterns work, they're different tables
		return false
	}
	
	// For non-table resources, all ID components must match exactly
	return ids1.pageId === ids2.pageId && ids1.tableId === ids2.tableId
}

/**
 * Comprehensive URL parser that extracts IDs and names in a single pass
 */
export function parseCompleteCodaUrl(url: string): CodaLinkData | null {
	try {
		// Parse the main URL structure
		const urlObj = new URL(url)
		const path = urlObj.pathname
		const hash = urlObj.hash
		
		// Extract document ID (always required)
		const docMatch = path.match(/\/d\/_d([^/?#]+)/)
		if (!docMatch) return null
		const docId = docMatch[1]
		
		// Extract page info from path: /d/_dDOCID/PageName_suPAGEID or /d/_dDOCID/DocPath/PageName_suPAGEID
		// Note: Document name cannot be reliably extracted from URL and must come from API
		const pathAfterDoc = path.substring(path.indexOf(`/_d${docId}`) + `/_d${docId}`.length)
		
		let pageName: string | undefined
		let pageId: string | undefined
		
		if (pathAfterDoc.startsWith('/')) {
			// Remove leading slash
			const pathParts = pathAfterDoc.substring(1)
			
			// Check if this has page info with _su
			if (pathParts.includes('_su')) {
				if (pathParts.includes('/')) {
					// Format: SomePath/PageName_suPAGEID - extract page name from last segment
					const pageMatch = pathParts.match(/\/([^/_]+)_su([^/?#]+)$/)
					if (pageMatch) {
						pageName = decodeURIComponent(pageMatch[1].replace(/-/g, ' '))
						pageId = pageMatch[2]
					}
				} else {
					// Format: PageName_suPAGEID - direct page name
					const directPageMatch = pathParts.match(/^(.+)_su([^/?#]+)$/)
					if (directPageMatch) {
						pageName = decodeURIComponent(directPageMatch[1].replace(/-/g, ' '))
						pageId = directPageMatch[2]
					}
				}
			}
		}
		
		// Extract table info from hash in different formats:
		// 1. User URLs: #TableName_tuTABLEID - e.g., #Current-OKR-Status_tunKXZE-
		// 2. API browserLink: #_tutable-TABLEID - e.g., #_tutable-Ozj5nKXZE-
		let tableName: string | undefined
		let tableId: string | undefined
		
		if (hash) {
			// Try user URL format first
			const userTableMatch = hash.match(/([^_#]+)_tu([^/?#&]+)/)
			if (userTableMatch) {
				tableName = decodeURIComponent(userTableMatch[1].replace(/-/g, ' '))
				tableId = userTableMatch[2]
			} else {
				// Try API browserLink format
				const apiBrowserLinkMatch = hash.match(/#_tutable-([^/?#&]+)/)
				if (apiBrowserLinkMatch) {
					tableId = apiBrowserLinkMatch[1]
					// No table name available in API browserLink format
					tableName = undefined
				}
			}
		}
		
		// Determine type based on what components we found
		let type: "document" | "page" | "section" | "table"
		if (tableId) {
			type = "table"
		} else if (pageId) {
			type = "page"
		} else {
			type = "document"
		}
		
		return {
			docId,
			pageId,
			tableId,
			originalUrl: url,
			type,
			pageName,
			tableName
		}
	} catch {
		return null
	}
}

export function parseCodaUrls(text: string): CodaLinkData[] {
	const links: CodaLinkData[] = []
	const seenUrls = new Set<string>()
	
	// Find all Coda URLs in the text
	const urlRegex = /https:\/\/coda\.io\/d\/[^\s<>]+/g
	let match: RegExpExecArray | null
	
	while ((match = urlRegex.exec(text)) !== null) {
		const url = match[0]
		
		// Skip duplicates
		if (seenUrls.has(url)) continue
		seenUrls.add(url)
		
		const parsed = parseCompleteCodaUrl(url)
		if (parsed) {
			links.push(parsed)
		}
	}

	return links
}