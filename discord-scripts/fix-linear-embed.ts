import {
  Client,
  EmbedBuilder,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
  Message,
} from "discord.js"
import { Log, Robot } from "hubot"
import { LinearClient } from "@linear/sdk"

const { LINEAR_API_TOKEN } = process.env

// track processed message to avoid duplicates if original message is edited
const processedMessages = new Map<string, Set<string>>()
// let us also track sent embeds to delete them if the original message is deleted or edited WIP
const sentEmbeds = new Map<string, Message>()

let issueTagRegex: RegExp | null = null

async function fetchIssuePrefixes(
  linearClient: LinearClient,
): Promise<string[]> {
  try {
    const teams = await linearClient.teams()
    return teams.nodes.map((team) => team.key)
  } catch (error) {
    console.error("Failed to fetch issue prefixes:", error)
    return []
  }
}

function updateIssueTagRegex(prefixes: string[]) {
  issueTagRegex = new RegExp(`\\b(${prefixes.join("|")})-\\d+\\b`, "gi")
}

async function initializeIssueTagRegex(linearClient: LinearClient) {
  const prefixes = await fetchIssuePrefixes(linearClient)
  updateIssueTagRegex(prefixes)
}

const issueUrlRegex =
  /https:\/\/linear\.app\/([a-zA-Z0-9-]+)\/issue\/([a-zA-Z0-9-]+)(?:.*#comment-([a-zA-Z0-9]+))?/g

function truncateToWords(
  content: string | undefined,
  ifBlank: string,
  maxWords = 50,
): string {
  if (content === undefined || content.trim() === "") {
    return ifBlank
  }

  const truncatedContent = content.split(" ").slice(0, maxWords).join(" ")

  if (truncatedContent !== content) {
    return `${truncatedContent}...`
  }

  return content
}

async function createLinearEmbed(
  linearClient: LinearClient,
  issueId: string,
  commentId?: string,
  teamName?: string,
) {
  try {
    const issue = await linearClient.issue(issueId)

    const project = issue.project ? await issue.project : null
    const state = issue.state ? await issue.state : null
    const assignee = issue.assignee ? await issue.assignee : null
    const comments = await issue.comments()
    const comment = commentId
      ? comments.nodes.find((c) => c.id.startsWith(commentId))
      : null

    const embed = new EmbedBuilder()

    if (comment) {
      // Comment-focused embed
      embed
        .setTitle(`Comment on Issue: ${issue.title}`)
        .setURL(
          `https://linear.app/${teamName}/issue/${issue.identifier}#comment-${commentId}`,
        )
        .setDescription(
          truncateToWords(comment.body, "No comment body available.", 50),
        )
        .addFields(
          {
            name: "Issue",
            value: `${issue.title} (${state?.name || "No status"})`,
            inline: false,
          },
          {
            name: "Assignee",
            value: assignee?.name.toString() || "Unassigned",
            inline: true,
          },
          {
            name: "Priority",
            value: issue.priority?.toString() || "None",
            inline: true,
          },
        )
        .setFooter({ text: `Project: ${project?.name || "No project"}` })
    } else {
      // Issue-focused embed
      embed
        .setTitle(`Issue: ${issue.title}`)
        .setURL(`https://linear.app/${teamName}/issue/${issue.identifier}`)
        .setDescription(
          truncateToWords(issue.description, "No description available.", 50),
        )
        .addFields(
          { name: "Status", value: state?.name || "No status", inline: true },
          {
            name: "Assignee",
            value: assignee?.name.toString() || "Unassigned",
            inline: true,
          },
          {
            name: "Priority",
            value: issue.priority?.toString() || "None",
            inline: true,
          },
        )
        .setFooter({ text: `Project: ${project?.name || "No project"}` })

      if (comments.nodes.length > 0) {
        embed.addFields({
          name: "Recent Comment",
          value: truncateToWords(
            comments.nodes[0].body,
            "No recent comment.",
            25,
          ),
        })
      }
    }

    if (issue.updatedAt) {
      embed.setTimestamp(new Date(issue.updatedAt))
    }

    return embed
  } catch (error) {
    console.error("Error creating Linear embed:", error)
    return null
  }
}

async function processLinearEmbeds(
  message: string,
  messageId: string,
  channel: TextChannel | ThreadChannel | VoiceChannel,
  logger: Log,
  linearClient: LinearClient,
) {
  if (!issueTagRegex) {
    logger.error("IssueTagRegex is not initialized.")
    return
  }

  const urlMatches = Array.from(message.matchAll(issueUrlRegex))
  const issueMatches = Array.from(message.matchAll(issueTagRegex))

  if (urlMatches.length === 0 && issueMatches.length === 0) {
    return
  }

  const processedIssues = processedMessages.get(messageId) || new Set<string>()
  processedMessages.set(messageId, processedIssues)

  const uniqueMatches = new Set<string>()

  urlMatches.forEach((match) => {
    const teamName = match[1]
    const issueId = match[2]
    const commentId = match[3] || undefined
    const uniqueKey = `${issueId}-${commentId || ""}`

    if (!processedIssues.has(uniqueKey)) {
      processedIssues.add(uniqueKey)
      uniqueMatches.add(JSON.stringify({ issueId, commentId, teamName }))
    }
  })

  issueMatches.forEach((match) => {
    const issueId = match[0]

    if (
      Array.from(uniqueMatches).some(
        (uniqueMatch) => JSON.parse(uniqueMatch).issueId === issueId,
      )
    ) {
      return
    }

    const uniqueKey = `${issueId}`
    if (!processedIssues.has(uniqueKey)) {
      processedIssues.add(uniqueKey)
      uniqueMatches.add(
        JSON.stringify({ issueId, commentId: undefined, teamName: undefined }),
      )
    }
  })

  const embedPromises = Array.from(uniqueMatches).map(async (matchString) => {
    const { issueId, commentId, teamName } = JSON.parse(matchString)

    logger.debug(
      `Processing issue: ${issueId}, comment: ${commentId}, team: ${teamName}`,
    )

    const embed = await createLinearEmbed(
      linearClient,
      issueId,
      commentId,
      teamName,
    )

    return { embed, issueId }
  })

  const results = await Promise.all(embedPromises)

  results
    .filter(
      (result): result is { embed: EmbedBuilder; issueId: string } =>
        result !== null,
    )
    .forEach(({ embed, issueId }) => {
      if (embed) {
        channel
          .send({ embeds: [embed] })
          .then((sentMessage) => {
            sentEmbeds.set(messageId, sentMessage)
          })
          .catch((error) =>
            logger.error(
              `Failed to send embed for issue ID: ${issueId}: ${error}`,
            ),
          )
      } else {
        logger.error(`Failed to create embed for issue ID: ${issueId}`)
      }
    })
}

export default async function linearEmbeds(
  discordClient: Client,
  robot: Robot,
) {
  const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })

  await initializeIssueTagRegex(linearClient)

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

    robot.logger.debug(`Processing message: ${message.content}`)
    await processLinearEmbeds(
      message.content,
      message.id,
      message.channel,
      robot.logger,
      linearClient,
    )
  })

  discordClient.on("messageUpdate", async (oldMessage, newMessage) => {
    if (
      !newMessage.content ||
      !(
        newMessage.channel instanceof TextChannel ||
        newMessage.channel instanceof ThreadChannel ||
        newMessage.channel instanceof VoiceChannel
      ) ||
      newMessage.author?.bot
    ) {
      return
    }

    const embedMessage = sentEmbeds.get(newMessage.id)
    const urlMatches = Array.from(newMessage.content.matchAll(issueUrlRegex))
    const issueMatches = issueTagRegex
      ? Array.from(newMessage.content.matchAll(issueTagRegex))
      : []

    if (urlMatches.length === 0 && issueMatches.length === 0) {
      if (embedMessage) {
        await embedMessage.delete().catch((error) => {
          robot.logger.error(
            `Failed to delete embed for message ID: ${newMessage.id}: ${error}`,
          )
        })
        sentEmbeds.delete(newMessage.id)
      }
      return
    }

    const match = urlMatches[0] || issueMatches[0]
    const teamName = match[1] || undefined
    const issueId = match[2] || match[0]
    const commentId = urlMatches.length > 0 ? match[3] || undefined : undefined

    if (embedMessage) {
      // we will then update the existing embed
      try {
        const embed = await createLinearEmbed(
          linearClient,
          issueId,
          commentId,
          teamName,
        )
        if (embed) {
          await embedMessage.edit({ embeds: [embed] })
          robot.logger.debug(`Updated embed for message ID: ${newMessage.id}`)
        } else {
          robot.logger.error(
            `Failed to create embed for updated message ID: ${newMessage.id}`,
          )
        }
      } catch (error) {
        robot.logger.error(
          `Failed to edit embed for message ID: ${newMessage.id}: ${error}`,
        )
      }
    } else {
      await processLinearEmbeds(
        newMessage.content,
        newMessage.id,
        newMessage.channel as TextChannel | ThreadChannel,
        robot.logger,
        linearClient,
      )
    }
  })

  discordClient.on("messageDelete", async (message) => {
    const embedMessage = sentEmbeds.get(message.id)
    if (embedMessage) {
      await embedMessage.delete().catch((error) => {
        robot.logger.error(
          `Failed to delete embed for message ID: ${message.id}: ${error}`,
        )
      })
      sentEmbeds.delete(message.id)
    }
  })
}
