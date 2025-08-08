import axios, { AxiosInstance } from "axios"
import {
	Client,
	EmbedBuilder,
	Message,
	TextChannel,
	ThreadChannel,
	VoiceChannel,
} from "discord.js"
import { Log, Robot } from "hubot"

const { CODA_API_TOKEN } = process.env

// Add channelIDs which should ignore the embed processing entirely
const IGNORED_CHANNELS = new Set<string>([])

// Cache for storing API responses to reduce rate limit usage
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Track processed messages to avoid duplicates if original message is edited
const processedMessages = new Map<
	string,
	Map<
		string,
		{
			docId: string
			pageId?: string
			sectionId?: string
			tableId?: string
		}
	>
>()

// Track sent embeds to delete them if the original message is deleted or edited
const sentEmbeds = new Map<string, Map<string, Message>>()

// URL pattern matching for different Coda link types
const CODA_URL_PATTERNS = {
	document: /https:\/\/coda\.io\/d\/([^\/\?#]+)(?:\/([^\/\?#_]+))?/g,
	section: /https:\/\/coda\.io\/d\/([^\/\?#]+)\/_su([^\/\?#]+)/g,
	table: /https:\/\/coda\.io\/d\/([^\/\?#]+)\/_t([^\/\?#]+)/g,
}

type CodaLinkData = {
	docId: string
	pageId?: string
	sectionId?: string
	tableId?: string
	originalUrl: string
	type: "document" | "page" | "section" | "table"
}

type CodaDocument = {
	id: string
	name: string
	owner: string
	ownerName: string
	browserLink: string
	createdAt: string
	updatedAt: string
	published?: {
		description?: string
		imageLink?: string
	}
	workspace: {
		name: string
		browserLink: string
	}
}

type CodaPage = {
	id: string
	name: string
	subtitle?: string
	browserLink: string
	contentTypes: string[]
	parent?: {
		name: string
	}
	createdAt: string
	updatedAt: string
}

type CodaSection = {
	id: string
	name: string
	browserLink: string
	parent: {
		name: string
	}
}

type CodaTable = {
	id: string
	name: string
	browserLink: string
	parent: {
		name: string
	}
	columns: Array<{
		id: string
		name: string
		type: string
	}>
}

class CodaApiClient {
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

	private getCacheKey(endpoint: string): string {
		return `coda_api:${endpoint}`
	}

	private getFromCache<T>(key: string): T | null {
		const cached = cache.get(key)
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return cached.data as T
		}
		cache.delete(key)
		return null
	}

	private setCache(key: string, data: any): void {
		cache.set(key, { data, timestamp: Date.now() })
	}

	async getDocument(docId: string): Promise<CodaDocument | null> {
		const cacheKey = this.getCacheKey(`docs/${docId}`)
		const cached = this.getFromCache<CodaDocument>(cacheKey)
		if (cached) return cached

		try {
			const response = await this.client.get(`/docs/${docId}`)
			const data = response.data as CodaDocument
			this.setCache(cacheKey, data)
			return data
		} catch (_error) {
			return null
		}
	}

	async getPage(docId: string, pageId: string): Promise<CodaPage | null> {
		const cacheKey = this.getCacheKey(`docs/${docId}/pages/${pageId}`)
		const cached = this.getFromCache<CodaPage>(cacheKey)
		if (cached) return cached

		try {
			const response = await this.client.get(`/docs/${docId}/pages/${pageId}`)
			const data = response.data as CodaPage
			this.setCache(cacheKey, data)
			return data
		} catch (_error) {
			return null
		}
	}

	async getSection(docId: string, sectionId: string): Promise<CodaSection | null> {
		const cacheKey = this.getCacheKey(`docs/${docId}/sections/${sectionId}`)
		const cached = this.getFromCache<CodaSection>(cacheKey)
		if (cached) return cached

		try {
			const response = await this.client.get(`/docs/${docId}/sections/${sectionId}`)
			const data = response.data as CodaSection
			this.setCache(cacheKey, data)
			return data
		} catch (_error) {
			return null
		}
	}

	async getTable(docId: string, tableId: string): Promise<CodaTable | null> {
		const cacheKey = this.getCacheKey(`docs/${docId}/tables/${tableId}`)
		const cached = this.getFromCache<CodaTable>(cacheKey)
		if (cached) return cached

		try {
			const [tableResponse, columnsResponse] = await Promise.all([
				this.client.get(`/docs/${docId}/tables/${tableId}`),
				this.client.get(`/docs/${docId}/tables/${tableId}/columns`),
			])
			
			const tableData = tableResponse.data
			const columnsData = columnsResponse.data
			
			const data: CodaTable = {
				...tableData,
				columns: columnsData.items || [],
			}
			
			this.setCache(cacheKey, data)
			return data
		} catch (_error) {
			return null
		}
	}
}

function parseCodaUrls(text: string): CodaLinkData[] {
	const links: CodaLinkData[] = []

	// Reset regex indices
	CODA_URL_PATTERNS.document.lastIndex = 0
	CODA_URL_PATTERNS.section.lastIndex = 0
	CODA_URL_PATTERNS.table.lastIndex = 0

	// Check for section URLs first (most specific)
	let match: RegExpExecArray | null
	while ((match = CODA_URL_PATTERNS.section.exec(text)) !== null) {
		links.push({
			docId: match[1],
			sectionId: match[2],
			originalUrl: match[0],
			type: "section",
		})
	}

	// Check for table URLs
	CODA_URL_PATTERNS.table.lastIndex = 0
	while ((match = CODA_URL_PATTERNS.table.exec(text)) !== null) {
		links.push({
			docId: match[1],
			tableId: match[2],
			originalUrl: match[0],
			type: "table",
		})
	}

	// Check for document/page URLs (least specific, check last)
	CODA_URL_PATTERNS.document.lastIndex = 0
	while ((match = CODA_URL_PATTERNS.document.exec(text)) !== null) {
		// Skip if already found as section or table
		if (
			links.some(
				(link) =>
					link.originalUrl === match?.[0] ||
					match?.[0].includes("_su") ||
					match?.[0].includes("_t"),
			)
		) {
			continue
		}

		links.push({
			docId: match[1],
			pageId: match[2],
			originalUrl: match[0],
			type: match[2] ? "page" : "document",
		})
	}

	return links
}

function truncateToWords(
	content: string | undefined,
	ifBlank: string,
	maxWords = 50,
): string {
	if (content === undefined || content.trim() === "") {
		return ifBlank
	}

	const words = content.split(" ")
	if (words.length <= maxWords) {
		return content
	}

	return `${words.slice(0, maxWords).join(" ")}...`
}

async function createCodaEmbed(
	linkData: CodaLinkData,
	codaClient: CodaApiClient,
	compact: boolean = false,
): Promise<EmbedBuilder | null> {
	try {
		const document = await codaClient.getDocument(linkData.docId)
		if (!document) return null

		const embed = new EmbedBuilder().setTimestamp(new Date(document.updatedAt))

		if (linkData.type === "document") {
			// Document-only embed
			embed
				.setTitle(document.name)
				.setURL(linkData.originalUrl)
				.setDescription(
					truncateToWords(
						document.published?.description,
						"No description available.",
						compact ? 25 : 50,
					),
				)
				.setAuthor({ name: document.ownerName })

			if (!compact) {
				embed.addFields({
					name: "Workspace",
					value: document.workspace.name,
					inline: true,
				})
			}
		} else if (linkData.type === "page" && linkData.pageId) {
			// Page-specific embed
			const page = await codaClient.getPage(linkData.docId, linkData.pageId)
			if (!page) return null

			embed
				.setTitle(`${document.name} - ${page.name}`)
				.setURL(linkData.originalUrl)
				.setDescription(
					truncateToWords(
						page.subtitle,
						"No description available.",
						compact ? 25 : 50,
					),
				)
				.setAuthor({ name: document.ownerName })

			if (!compact) {
				embed.addFields(
					{
						name: "Document",
						value: `[${document.name}](${document.browserLink})`,
						inline: true,
					},
					{
						name: "Workspace",
						value: document.workspace.name,
						inline: true,
					},
				)

				if (page.parent) {
					embed.addFields({
						name: "Parent Page",
						value: page.parent.name,
						inline: true,
					})
				}
			}
		} else if (linkData.type === "section" && linkData.sectionId) {
			// Section-specific embed
			const section = await codaClient.getSection(linkData.docId, linkData.sectionId)
			if (!section) return null

			embed
				.setTitle(`${document.name} - ${section.name}`)
				.setURL(linkData.originalUrl)
				.setDescription("Section in Coda document")
				.setAuthor({ name: document.ownerName })

			if (!compact) {
				embed.addFields(
					{
						name: "Document",
						value: `[${document.name}](${document.browserLink})`,
						inline: true,
					},
					{
						name: "Parent Page",
						value: section.parent.name,
						inline: true,
					},
				)
			}
		} else if (linkData.type === "table" && linkData.tableId) {
			// Table-specific embed
			const table = await codaClient.getTable(linkData.docId, linkData.tableId)
			if (!table) return null

			embed
				.setTitle(`${document.name} - ${table.name}`)
				.setURL(linkData.originalUrl)
				.setDescription(`Table with ${table.columns.length} columns`)
				.setAuthor({ name: document.ownerName })

			if (!compact && table.columns.length > 0) {
				const columnList = table.columns
					.slice(0, 5)
					.map((col) => col.name)
					.join(", ")
				const moreColumns =
					table.columns.length > 5 ? ` (+${table.columns.length - 5} more)` : ""

				embed.addFields(
					{
						name: "Document",
						value: `[${document.name}](${document.browserLink})`,
						inline: true,
					},
					{
						name: "Parent Page",
						value: table.parent.name,
						inline: true,
					},
					{
						name: "Columns",
						value: `${columnList}${moreColumns}`,
						inline: false,
					},
				)
			}
		}

		return embed
	} catch (_error) {
		// Log error but don't throw - return null to gracefully handle failures
		return null
	}
}

async function processCodaEmbeds(
	message: string,
	messageId: string,
	channel: TextChannel | ThreadChannel | VoiceChannel,
	logger: Log,
	codaClient: CodaApiClient,
) {
	if (IGNORED_CHANNELS.has(channel.id)) {
		logger.debug(`Ignoring embeds in channel: ${channel.id}`)
		return
	}

	// Allow users to skip embed processing
	if (message.includes("<no-embeds>")) {
		logger.debug(
			`Skipping embeds for message: ${messageId} (contains <no-embeds>)`,
		)
		return
	}

	const codaLinks = parseCodaUrls(message)
	if (codaLinks.length === 0) {
		return
	}

	const processedLinks =
		processedMessages.get(messageId) ??
		new Map<
			string,
			{
				docId: string
				pageId?: string
				sectionId?: string
				tableId?: string
			}
		>()
	processedMessages.set(messageId, processedLinks)

	// Process each unique Coda link
	codaLinks.forEach((linkData) => {
		const uniqueKey = `${linkData.docId}-${linkData.pageId || ""}-${
			linkData.sectionId || ""
		}-${linkData.tableId || ""}`

		if (!processedLinks.has(uniqueKey)) {
			processedLinks.set(uniqueKey, {
				docId: linkData.docId,
				pageId: linkData.pageId,
				sectionId: linkData.sectionId,
				tableId: linkData.tableId,
			})
		}
	})

	const embedPromises = codaLinks.map(async (linkData) => {
		logger.debug(
			`Processing Coda link: ${linkData.type} - ${linkData.originalUrl}`,
		)
		const compactMode = codaLinks.length > 2

		const embed = await createCodaEmbed(linkData, codaClient, compactMode)
		return { embed, linkData }
	})

	const results = await Promise.all(embedPromises)

	results
		.filter(
			(result): result is { embed: EmbedBuilder; linkData: CodaLinkData } =>
				result.embed !== null,
		)
		.forEach(({ embed, linkData }) => {
			const uniqueKey = `${linkData.docId}-${linkData.pageId || ""}-${
				linkData.sectionId || ""
			}-${linkData.tableId || ""}`

			if (!sentEmbeds.has(messageId)) {
				sentEmbeds.set(messageId, new Map())
			}
			const messageEmbeds = sentEmbeds.get(messageId)!

			if (messageEmbeds.has(uniqueKey)) {
				messageEmbeds
					.get(uniqueKey)!
					.edit({ embeds: [embed] })
					.catch((error) =>
						logger.error(
							`Failed to edit embed for Coda link ${uniqueKey}: ${error}`,
						),
					)
			} else {
				channel
					.send({ embeds: [embed] })
					.then((sentMessage) => {
						messageEmbeds.set(uniqueKey, sentMessage)
					})
					.catch((error) =>
						logger.error(
							`Failed to send embed for Coda link ${uniqueKey}: ${error}`,
						),
					)
			}
		})
}

export default async function codaEmbeds(
	discordClient: Client,
	robot: Robot,
) {
	if (!CODA_API_TOKEN) {
		robot.logger.warn(
			"CODA_API_TOKEN not found. Coda embed processing will be disabled.",
		)
		return
	}

	const codaClient = new CodaApiClient(CODA_API_TOKEN)

	discordClient.on("messageCreate", async (message: Message) => {
		if (
			message.author.bot ||
			!(
				message.channel instanceof TextChannel ||
				message.channel instanceof ThreadChannel ||
				message.channel instanceof VoiceChannel
			)
		) {
			return
		}

		robot.logger.debug(`Processing message for Coda embeds: ${message.content}`)
		await processCodaEmbeds(
			message.content,
			message.id,
			message.channel,
			robot.logger,
			codaClient,
		)
	})

	discordClient.on("messageUpdate", async (oldMessage, newMessage) => {
		if (
			!newMessage.content ||
			!(
				newMessage.channel instanceof TextChannel ||
				newMessage.channel instanceof ThreadChannel
			) ||
			newMessage.author?.bot
		) {
			return
		}

		const messageEmbeds = sentEmbeds.get(newMessage.id) ?? new Map()
		
		// Parse old and new Coda links
		const oldLinks = oldMessage.content ? parseCodaUrls(oldMessage.content) : []
		const newLinks = parseCodaUrls(newMessage.content)
		
		const oldKeys = new Set(
			oldLinks.map((link) => `${link.docId}-${link.pageId || ""}-${link.sectionId || ""}-${link.tableId || ""}`)
		)
		const newKeys = new Set(
			newLinks.map((link) => `${link.docId}-${link.pageId || ""}-${link.sectionId || ""}-${link.tableId || ""}`)
		)

		// Remove embeds for deleted links
		oldKeys.forEach((key) => {
			if (!newKeys.has(key) && messageEmbeds.has(key)) {
				messageEmbeds.get(key)?.delete().catch((error) =>
					robot.logger.error(`Failed to delete Coda embed: ${error}`)
				)
				messageEmbeds.delete(key)
			}
		})

		// Add embeds for new links
		const addedLinks = newLinks.filter((link) => {
			const key = `${link.docId}-${link.pageId || ""}-${link.sectionId || ""}-${link.tableId || ""}`
			return !oldKeys.has(key) && !messageEmbeds.has(key)
		})

		if (addedLinks.length > 0) {
			await processCodaEmbeds(
				newMessage.content,
				newMessage.id,
				newMessage.channel,
				robot.logger,
				codaClient,
			)
		}
	})

	discordClient.on("messageDelete", async (message) => {
		const embedMessages = sentEmbeds.get(message.id)
		if (embedMessages) {
			await Promise.all(
				Array.from(embedMessages.values()).map((embedMessage) =>
					embedMessage.delete().catch((error: unknown) => {
						if (error instanceof Error) {
							robot.logger.error(`Failed to delete Coda embed: ${error.message}`)
						} else {
							robot.logger.error(`Unknown error deleting Coda embed: ${error}`)
						}
					}),
				),
			)
			sentEmbeds.delete(message.id)
		}
		processedMessages.delete(message.id)
	})

	robot.logger.info("✅ Coda embed processing enabled")
}