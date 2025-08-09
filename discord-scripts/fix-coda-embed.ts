import axios, { AxiosError } from "axios"
import {
	Client,
	EmbedBuilder,
	Message,
	TextChannel,
	ThreadChannel,
	VoiceChannel,
} from "discord.js"
import { Log, Robot } from "hubot"
import {
	CodaApiClient,
	isRateLimitError,
	parseCodaUrls,
	type CodaDocument,
	type CodaPage,
	type CodaTable,
	type CodaLinkData,
	type CodaResolvedResource,
	type RateLimitError,
} from "../lib/coda/index.ts"

const { HUBOT_CODA_TOKEN } = process.env

// Add channelIDs which should ignore the embed processing entirely
const IGNORED_CHANNELS = new Set<string>([])

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

function truncateToWords(
	content: string | undefined,
	ifBlank: string,
	maxWords = 50,
): string {
	if (content === undefined || content.trim() === "") {
		return ifBlank || "No description available."
	}

	const words = content.split(" ")
	if (words.length <= maxWords) {
		return content
	}

	return `${words.slice(0, maxWords).join(" ")}...`
}

/**
 * Gets the best image URL for an embed from page-specific sources only.
 * Priority: page image > page icon
 * Returns undefined if no page is provided or no page images are available.
 */
function getPageImageUrl(page?: CodaPage): string | undefined {
	if (!page) {
		return undefined
	}
	
	// Try page image first
	if (page.image?.browserLink) {
		return page.image.browserLink
	}
	
	// Try page icon
	if (page.icon?.browserLink) {
		return page.icon.browserLink
	}
	
	return undefined
}

/**
 * Gets the best timestamp for an embed with proper fallback hierarchy:
 * table.updatedAt → page.updatedAt → document.updatedAt
 */
function getBestTimestamp(document: CodaDocument, page?: CodaPage, table?: CodaTable): Date {
	if (table && table.updatedAt) {
		return new Date(table.updatedAt)
	}
	if (page && page.updatedAt) {
		return new Date(page.updatedAt)
	}
	return new Date(document.updatedAt)
}

/**
 * Sets the document footer for an embed with document name and icon
 */
function setDocumentFooter(embed: EmbedBuilder, document: CodaDocument): void {
	const iconUrl = document.icon?.browserLink || document.published?.imageLink
	embed.setFooter({
		text: document.name,
		iconURL: iconUrl
	})
}

/**
 * Creates a placeholder embed that's shown immediately while we resolve the real data
 */
function createPlaceholderEmbed(linkData: CodaLinkData): EmbedBuilder {
	let title = 'Loading Coda content...'
	let description = `🔄 Resolving ${linkData.type} details...`
	
	// Use names extracted during URL parsing
	if (linkData.type === 'document') {
		title = '📄 Coda Document'
		description = '🔄 Loading document details...'
	} else if (linkData.type === 'page' && linkData.pageName) {
		title = `📄 ${linkData.pageName}`
		description = '🔄 Loading page details...'
	} else if (linkData.type === 'table' && linkData.tableName) {
		title = `📊 ${linkData.tableName}`
		description = '🔄 Loading table details...'
	}

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setURL(linkData.originalUrl)
		.setDescription(description)
		.setColor(0x007ACC) // Coda blue
		.setTimestamp()

	return embed
}

/**
 * Helper function to suppress Discord embeds on a message
 */
async function suppressEmbedsOnMessage(message: Message | null): Promise<void> {
	if (message?.suppressEmbeds) {
		try {
			await message.suppressEmbeds(true)
		} catch {
			// Continue if suppression fails
		}
	}
}

async function createCodaEmbed(
	logger: Log,
	linkData: CodaLinkData,
	codaClient: CodaApiClient,
	compact: boolean = false,
): Promise<EmbedBuilder | null> {
	logger.debug("Resolving Coda link via resolveBrowserLinkResource", linkData.originalUrl)
	try {
		// Use resolveBrowserLinkResource to get the complete resource metadata
		const resolvedResource = await codaClient.resolveBrowserLinkResource(linkData.originalUrl, logger)
		logger.debug("Resolved resource", resolvedResource)

		const embed = new EmbedBuilder()

		if (resolvedResource.type === "doc") {
			const document = resolvedResource.doc!
			if (!document) {
				throw new Error("Document data missing from resolved resource")
			}
			// Document-only embed
			embed
				.setTitle(document.name || "Coda Document")
				.setURL(linkData.originalUrl)
				.setDescription(
					truncateToWords(
						document.published?.description,
						"No description available.",
						compact ? 25 : 50,
					),
				)
				.setAuthor({ name: document.ownerName })
				.setTimestamp(getBestTimestamp(document))
			
			// Document embeds don't have thumbnails - use footer for document info instead

			// For document embeds, use workspace as footer instead of document footer
			embed.setFooter({
				text: document.workspace.name
			})

			if (!compact) {
				embed.addFields({
					name: "Created",
					value: new Date(document.createdAt).toLocaleDateString(),
					inline: true,
				})
			}
		} else if (resolvedResource.type === "page") {
			const page = resolvedResource.page!
			const document = resolvedResource.doc!
			if (!page || !document) {
				throw new Error("Page or document data missing from resolved resource")
			}
			
			embed
				.setTitle(page.name || "Coda Page")
				.setURL(linkData.originalUrl)
				.setDescription(
					truncateToWords(
						page.subtitle,
						"No description available.",
						compact ? 25 : 50,
					),
				)
				.setAuthor({ name: document.ownerName })
				.setTimestamp(getBestTimestamp(document, page))
			
			// Add page image/icon as thumbnail if available
			const imageUrl = getPageImageUrl(page)
			if (imageUrl) {
				embed.setThumbnail(imageUrl)
			}

			// Set document as footer
			setDocumentFooter(embed, document)

			if (!compact) {
				const fields = [{
					name: "Workspace",
					value: document.workspace.name,
					inline: true,
				}]

				if (page.parent) {
					fields.push({
						name: "Parent Page",
						value: page.parent.name,
						inline: true,
					})
				}
				
				embed.addFields(fields)
			}
		} else if (resolvedResource.type === "section") {
			const section = resolvedResource.section!
			const document = resolvedResource.doc!
			if (!section || !document) {
				throw new Error("Section or document data missing from resolved resource")
			}

			embed
				.setTitle(section.name || "Coda Section")
				.setURL(linkData.originalUrl)
				.setDescription("Section in Coda document")
				.setAuthor({ name: document.ownerName })
				.setTimestamp(getBestTimestamp(document))
			
			// Sections don't have direct access to page data, so no thumbnail

			// Set document as footer
			setDocumentFooter(embed, document)

			if (!compact) {
				embed.addFields({
					name: "Parent Page",
					value: section.parent.name,
					inline: true,
				})
			}
		} else if (resolvedResource.type === "table") {
			const table = resolvedResource.table!
			const document = resolvedResource.doc!
			const parentPage = resolvedResource.page // Already fetched by resolveBrowserLinkResource
			
			if (!table || !document) {
				throw new Error("Table or document data missing from resolved resource")
			}

			const columnCount = (table.columns && Array.isArray(table.columns)) ? table.columns.length : 0
			embed
				.setTitle(table.name || "Coda Table")
				.setURL(linkData.originalUrl)
				.setDescription(`Table with ${columnCount} columns`)
				.setAuthor({ name: document.ownerName })
				.setTimestamp(getBestTimestamp(document, parentPage, table))
			
			// Add page image/icon as thumbnail if available
			const imageUrl = getPageImageUrl(parentPage)
			if (imageUrl) {
				embed.setThumbnail(imageUrl)
			}

			// Set document as footer
			setDocumentFooter(embed, document)

			if (!compact && table.columns && table.columns.length > 0) {
				const columnList = table.columns
					.slice(0, 5)
					.map((col) => col.name)
					.join(", ")
				const moreColumns =
					table.columns.length > 5 ? ` (+${table.columns.length - 5} more)` : ""

				const fields = [{
					name: "Parent Page",
					value: parentPage ? `[${table.parent.name}](${parentPage.browserLink})` : table.parent.name,
					inline: true,
				}, {
					name: "Columns",
					value: `${columnList}${moreColumns}`,
					inline: false,
				}]
				
				embed.addFields(fields)
			}
		}

		// Final safety check: ensure embed has a description
		const embedData = embed.toJSON()
		if (!embedData.description || embedData.description.trim() === "") {
			embed.setDescription("No description available.")
		}

		return embed
	} catch (error) {
		// Log detailed error information and return null to gracefully handle failures
		logger.error(`Error creating Coda embed for ${linkData.type} ${linkData.originalUrl}:`, error)
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

	// Fetch the original message once and suppress Discord's automatic embeds
	let originalMessage: Message | null = null
	try {
		originalMessage = await channel.messages.fetch(messageId)
		await suppressEmbedsOnMessage(originalMessage)
	} catch (error) {
		logger.debug(`Could not suppress Discord embeds initially: ${error}`)
		// Continue anyway - this is best effort
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

	// First, send placeholder embeds immediately and suppress Discord embeds
	const placeholderPromises = codaLinks.map(async (linkData) => {
		const uniqueKey = `${linkData.docId}-${linkData.pageId || ""}-${
			linkData.sectionId || ""
		}-${linkData.tableId || ""}`

		if (!sentEmbeds.has(messageId)) {
			sentEmbeds.set(messageId, new Map())
		}
		const messageEmbeds = sentEmbeds.get(messageId)!

		// Skip if we already have an embed for this link
		if (messageEmbeds.has(uniqueKey)) {
			return { placeholder: null, linkData, uniqueKey }
		}

		try {
			const placeholderEmbed = createPlaceholderEmbed(linkData)
			const sentMessage = await channel.send({ embeds: [placeholderEmbed] })
			messageEmbeds.set(uniqueKey, sentMessage)
			
			// Suppress embeds again after sending placeholder
			await suppressEmbedsOnMessage(originalMessage)
			
			return { placeholder: sentMessage, linkData, uniqueKey }
		} catch (error) {
			logger.error(`Failed to send placeholder for ${linkData.originalUrl}:`, error)
			return { placeholder: null, linkData, uniqueKey }
		}
	})

	const placeholderResults = await Promise.allSettled(placeholderPromises)
	const validPlaceholders = placeholderResults
		.filter((result) => result.status === 'fulfilled')
		.map((result) => (result as PromiseFulfilledResult<{ placeholder: Message | null; linkData: CodaLinkData; uniqueKey: string }>).value)
		.filter(item => item.placeholder !== null)

	// Now resolve the actual embed data in the background
	const embedPromises = validPlaceholders.map(async ({ linkData, uniqueKey }) => {
		logger.debug(
			`Resolving Coda link: ${linkData.type} - ${linkData.originalUrl}`,
		)
		const compactMode = codaLinks.length > 2

		try {
			const embed = await createCodaEmbed(logger, linkData, codaClient, compactMode)
			return { embed, linkData, uniqueKey }
		} catch (error) {
			// Handle rate limiting specially
			if (isRateLimitError(error)) {
				logger.info(`Rate limited for ${linkData.originalUrl}, will retry after ${Math.ceil(error.retryAfter / 1000)}s`)
				
				// Schedule a retry after the backoff period
				setTimeout(async () => {
					try {
						logger.debug(`Retrying rate-limited request for ${linkData.originalUrl}`)
						const retryEmbed = await createCodaEmbed(logger, linkData, codaClient, compactMode)
						
						// Update the existing placeholder message with the resolved content
						const messageEmbeds = sentEmbeds.get(messageId)
						const placeholderMessage = messageEmbeds?.get(uniqueKey)
						if (placeholderMessage && retryEmbed) {
							await placeholderMessage.edit({ embeds: [retryEmbed] })
							logger.debug(`Successfully updated rate-limited embed for ${linkData.originalUrl}`)
						}
					} catch (retryError) {
						logger.error(`Retry failed for ${linkData.originalUrl}:`, retryError)
						// If retry fails, update with error embed
						const messageEmbeds = sentEmbeds.get(messageId)
						const placeholderMessage = messageEmbeds?.get(uniqueKey)
						if (placeholderMessage) {
							let title = 'Failed to load Coda content'
							if (linkData.type === 'page' && linkData.pageName) title = `❌ ${linkData.pageName}`
							else if (linkData.type === 'table' && linkData.tableName) title = `❌ ${linkData.tableName}`
							else if (linkData.type === 'document') title = '❌ Coda Document'
							
							const errorEmbed = new EmbedBuilder()
								.setTitle(title)
								.setURL(linkData.originalUrl)
								.setDescription('Unable to load content from Coda API')
								.setColor(0xFF0000) // Red
								.setTimestamp()
							await placeholderMessage.edit({ embeds: [errorEmbed] })
						}
					}
				}, error.retryAfter * 1000)
				
				// Create a "rate limited" embed with enhanced title
				let title = '⏳ Loading Coda content...'
				if (linkData.type === 'page' && linkData.pageName) title = `⏳ ${linkData.pageName}`
				else if (linkData.type === 'table' && linkData.tableName) title = `⏳ ${linkData.tableName}`
				else if (linkData.type === 'document') title = '⏳ Coda Document'
				
				const rateLimitEmbed = new EmbedBuilder()
					.setTitle(title)
					.setURL(linkData.originalUrl)
					.setDescription(`🔄 Rate limited, retrying in ${Math.ceil(error.retryAfter / 1000)}s...`)
					.setColor(0xFFA500) // Orange
					.setTimestamp()
				return { embed: rateLimitEmbed, linkData, uniqueKey }
			}

			// Provide detailed error context for debugging API issues
			if (axios.isAxiosError(error)) {
				logger.error(`Coda API error for ${linkData.type} ${linkData.originalUrl}:`, {
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
					headers: error.response?.headers,
					url: error.config?.url
				})
			} else {
				logger.error(`Failed to create embed for Coda link ${linkData.originalUrl}:`, error)
			}
			return { embed: null, linkData, uniqueKey }
		}
	})

	const results = await Promise.allSettled(embedPromises)
	const successfulResults = results
		.filter((result) => result.status === 'fulfilled')
		.map((result) => (result as PromiseFulfilledResult<{embed: EmbedBuilder | null, linkData: CodaLinkData, uniqueKey: string}>).value)

	// Update placeholder embeds with resolved content
	const successfulEmbeds = successfulResults.filter(
		(result): result is { embed: EmbedBuilder; linkData: CodaLinkData; uniqueKey: string } =>
			result.embed !== null,
	)

	for (const { embed, linkData, uniqueKey } of successfulEmbeds) {
		const messageEmbeds = sentEmbeds.get(messageId)
		if (!messageEmbeds) continue

		try {
			// Update the placeholder embed with resolved content
			const placeholderMessage = messageEmbeds.get(uniqueKey)
			if (placeholderMessage) {
				await placeholderMessage.edit({ embeds: [embed] })
				
				// Suppress embeds again after sending final embed
				await suppressEmbedsOnMessage(originalMessage)
			}
		} catch (error) {
			logger.error(
				`Failed to update placeholder embed for ${linkData.originalUrl}:`,
				error,
			)
		}
	}
}

export default async function codaEmbeds(discordClient: Client, robot: Robot) {
	if (!HUBOT_CODA_TOKEN) {
		robot.logger.warning(
			"HUBOT_CODA_TOKEN not found. Coda embed processing will be disabled.",
		)
		return
	}

	const codaClient = new CodaApiClient(HUBOT_CODA_TOKEN)

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
		try {
			await processCodaEmbeds(
				message.content,
				message.id,
				message.channel,
				robot.logger,
				codaClient,
			)
		} catch (error) {
			robot.logger.error(`Error processing Coda embeds for message ${message.id}:`, error)
		}
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

		try {
			const messageEmbeds = sentEmbeds.get(newMessage.id) ?? new Map()

			// Parse old and new Coda links
			const oldLinks = oldMessage.content ? parseCodaUrls(oldMessage.content) : []
			const newLinks = parseCodaUrls(newMessage.content)

			const oldKeys = new Set(
				oldLinks.map(
					(link) =>
						`${link.docId}-${link.pageId || ""}-${link.sectionId || ""}-${link.tableId || ""}`,
				),
			)
			const newKeys = new Set(
				newLinks.map(
					(link) =>
						`${link.docId}-${link.pageId || ""}-${link.sectionId || ""}-${link.tableId || ""}`,
				),
			)

			// Remove embeds for deleted links
			for (const key of oldKeys) {
				if (!newKeys.has(key) && messageEmbeds.has(key)) {
					try {
						await messageEmbeds.get(key)?.delete()
						messageEmbeds.delete(key)
					} catch (error) {
						robot.logger.error(`Failed to delete Coda embed for key ${key}:`, error)
					}
				}
			}

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
		} catch (error) {
			robot.logger.error(`Error updating Coda embeds for message ${newMessage.id}:`, error)
		}
	})

	discordClient.on("messageDelete", async (message) => {
		try {
			const embedMessages = sentEmbeds.get(message.id)
			if (embedMessages) {
				await Promise.allSettled(
					Array.from(embedMessages.values()).map(async (embedMessage) => {
						try {
							await embedMessage.delete()
						} catch (error) {
							robot.logger.error(`Failed to delete Coda embed:`, error)
						}
					}),
				)
				sentEmbeds.delete(message.id)
			}
			processedMessages.delete(message.id)
		} catch (error) {
			robot.logger.error(`Error cleaning up Coda embeds for deleted message ${message.id}:`, error)
		}
	})

	robot.logger.info("✅ Coda embed processing enabled")
}
