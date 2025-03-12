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

// Add channelIDs which should ignore the embed processing entirely
const IGNORED_CHANNELS = new Set([
  "1187783048427741296", //#mezo-standup
])

// track processed message to avoid duplicates if original message is edited
const processedMessages = new Map<
  string,
  Map<
    string,
    {
      issueId?: string
      commentId?: string
      teamName?: string
      projectId?: string
      projectUpdateId?: string
    }
  >
>()

// let us also track sent embeds to delete them if the original message is deleted or edited WIP
const sentEmbeds = new Map<string, Map<string, Message>>()

let issueTagRegex: RegExp | null = null

function initializeIssueTagRegex() {
  issueTagRegex =
    /(?<!https:\/\/linear\.app\/[a-zA-Z0-9-]+\/issue\/)(?<![\[\<])[A-Z]{3,}-\d+(?![\]\>])\b/gi
}

const projectRegex =
  /https:\/\/linear\.app\/([a-zA-Z0-9-]+)\/project\/([a-zA-Z0-9-]+)(?:#projectUpdate-([a-zA-Z0-9]+))?/g

const issueUrlRegex =
  /(?<![\[\<])https:\/\/linear\.app\/([a-zA-Z0-9-]+)\/issue\/([a-zA-Z0-9-]+)(?:.*#comment-([a-zA-Z0-9]+))?(?![\]\>])/g

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
  issueId?: string,
  commentId?: string,
  projectId?: string,
  projectUpdateId?: string,
  compact: boolean = false,
) {
  try {
    const embed = new EmbedBuilder()

    // project embed handling
    if (projectId) {
      const cleanProjectId = projectId.split("-").pop()
      const project = cleanProjectId
        ? await linearClient.project(cleanProjectId)
        : null
      const updates = await project?.projectUpdates()
      const update = projectUpdateId
        ? updates?.nodes.find((u) => u.id.startsWith(projectUpdateId))
        : null

      if (project) {
        embed
          .setTitle(`Project: ${project.name}`)
          .setURL(project.url)
          .setDescription(
            truncateToWords(
              project.description,
              "No description available.",
              50,
            ),
          )
          .setTimestamp(new Date(project.updatedAt))
        if (update) {
          embed
            .setTitle(
              `Project Update: ${project.name} - ${new Date(
                project.updatedAt,
              ).toLocaleString()}`,
            )
            .setURL(`${project.url}#projectUpdate-${projectUpdateId}`)
            .setDescription(
              truncateToWords(update?.body, "No description available.", 50),
            )
        }
      }

      return embed
    }

    // issue + comment embed handling
    if (issueId) {
      const issue = await linearClient.issue(issueId)
      const state = issue.state ? await issue.state : null
      const assignee = issue.assignee ? await issue.assignee : null
      const comments = await issue.comments()
      const comment = commentId
        ? comments.nodes.find((c) => c.id.startsWith(commentId))
        : null

      if (compact) {
        embed.setTitle(`[${issue.identifier}] ${issue.title}`).setURL(issue.url)
        return embed
      }

      if (comment && compact) {
        embed
          .setTitle(`Comment on [${issue.identifier}] ${issue.title}`)
          .setURL(`${issue.url}#comment-${commentId}`)
        return embed
      }

      if (comment) {
        embed
          .setTitle(`Comment on [${issue.identifier}] ${issue.title}`)
          .setURL(`${issue.url}#comment-${commentId}`)
          .setDescription(
            truncateToWords(comment.body, "No comment body available.", 50),
          )
          .addFields(
            {
              name: "Issue",
              value: `${issue.title} (${state?.name || "No status"})`,
            },
            {
              name: "Assignee",
              value: assignee?.name || "Unassigned",
              inline: true,
            },
            {
              name: "Priority",
              value: issue.priority?.toString() || "None",
              inline: true,
            },
          )
      } else {
        embed
          .setTitle(`[${issue.identifier}] ${issue.title}`)
          .setURL(issue.url)
          .setDescription(
            truncateToWords(issue.description, "No description available.", 50),
          )
          .addFields(
            { name: "Status", value: state?.name || "No status", inline: true },
            {
              name: "Assignee",
              value: assignee?.name || "Unassigned",
              inline: true,
            },
            {
              name: "Priority",
              value: issue.priority?.toString() || "None",
              inline: true,
            },
          )
      }

      return embed
    }

    return null
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
  if (IGNORED_CHANNELS.has(channel.id)) {
    logger.debug(`Ignoring embeds in channel: ${channel.id}`)
    return
  }
  // Let's include a text call if no embeds are to be used in a message
  if (message.includes("<no_embeds>")) {
    logger.debug(
      `Skipping embeds for message: ${messageId} (contains <no_embeds>)`,
    )
    return
  }

  if (!issueTagRegex) {
    logger.error("IssueTagRegex is not initialized.")
    return
  }

  const urlMatches = Array.from(message.matchAll(issueUrlRegex))
  const issueMatches = Array.from(message.matchAll(issueTagRegex))
  const projectMatches = Array.from(message.matchAll(projectRegex))

  if (
    urlMatches.length === 0 &&
    issueMatches.length === 0 &&
    projectMatches.length === 0
  ) {
    return
  }

  const processedIssues =
    processedMessages.get(messageId) ??
    new Map<
      string,
      {
        issueId?: string
        commentId?: string
        teamName?: string
        projectId?: string
        projectUpdateId?: string
      }
    >()
  processedMessages.set(messageId, processedIssues)

  urlMatches.forEach((match) => {
    const teamName = match[1]
    const issueId = match[2]
    const commentId = match[3] || undefined
    const uniqueKey = `${issueId}-${commentId || ""}`

    if (!processedIssues.has(uniqueKey)) {
      processedIssues.set(uniqueKey, { issueId, commentId, teamName })
    }
  })

  issueMatches.forEach((match) => {
    const issueId = match[0]
    const uniqueKey = `${issueId}`

    if (!processedIssues.has(uniqueKey)) {
      processedIssues.set(uniqueKey, { issueId })
    }
  })

  projectMatches.forEach((match) => {
    const teamName = match[1]
    const projectId = match[2]
    const projectUpdateId = match[3]
    const uniqueKey = `project-${projectId}`

    if (!processedIssues.has(uniqueKey)) {
      processedIssues.set(uniqueKey, { projectId, teamName, projectUpdateId })
    }
  })

  const embedPromises = Array.from(processedIssues.values()).map(
    async ({ issueId, commentId, teamName, projectId, projectUpdateId }) => {
      logger.debug(
        `Processing issue: ${issueId}, comment: ${commentId ?? "N/A"}, team: ${
          teamName ?? "N/A"
        }`,
      )
      const compactMode = processedIssues.size > 2

      const embed = await createLinearEmbed(
        linearClient,
        issueId,
        commentId,
        projectId,
        projectUpdateId,
        compactMode,
      )
      return { embed, issueId }
    },
  )

  const results = await Promise.all(embedPromises)

  results
    .filter(
      (result): result is { embed: EmbedBuilder; issueId: string } =>
        result.embed !== null,
    )
    .forEach(({ embed, issueId }) => {
      if (!sentEmbeds.has(messageId)) {
        sentEmbeds.set(messageId, new Map())
      }
      const messageEmbeds = sentEmbeds.get(messageId)!

      if (messageEmbeds.has(issueId)) {
        messageEmbeds
          .get(issueId)!
          .edit({ embeds: [embed] })
          .catch((error) =>
            logger.error(
              `Failed to edit embed for issue ID: ${issueId}: ${error}`,
            ),
          )
      } else {
        channel
          .send({ embeds: [embed] })
          .then((sentMessage) => {
            messageEmbeds.set(issueId, sentMessage)
          })
          .catch((error) =>
            logger.error(
              `Failed to send embed for issue ID: ${issueId}: ${error}`,
            ),
          )
      }
    })
}

export default async function linearEmbeds(
  discordClient: Client,
  robot: Robot,
) {
  const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })
  initializeIssueTagRegex()

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
        newMessage.channel instanceof ThreadChannel
      ) ||
      newMessage.author?.bot
    ) {
      return
    }

    const messageEmbeds = sentEmbeds.get(newMessage.id) ?? new Map()
    const oldIssues = new Set<string>()
    const newIssues = new Set<string>()

    if (oldMessage.content) {
      [
        ...oldMessage.content.matchAll(issueUrlRegex),
        ...oldMessage.content.matchAll(issueTagRegex ?? /$^/),
      ].forEach((match) => oldIssues.add(match[2] ?? match[0]))
    }

    [
      ...newMessage.content.matchAll(issueUrlRegex),
      ...newMessage.content.matchAll(issueTagRegex ?? /$^/),
    ].forEach((match) => newIssues.add(match[2] ?? match[0]))

    oldIssues.forEach((issueId) => {
      if (!newIssues.has(issueId) && messageEmbeds.has(issueId)) {
        messageEmbeds.get(issueId)?.delete().catch(console.error)
        messageEmbeds.delete(issueId)
      }
    })

    const addedIssues = [...newIssues].filter(
      (issueId) => !oldIssues.has(issueId) && !messageEmbeds.has(issueId),
    )

    if (addedIssues.length > 0) {
      await processLinearEmbeds(
        newMessage.content,
        newMessage.id,
        newMessage.channel,
        robot.logger,
        linearClient,
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
              robot.logger.error(`Failed to delete embed: ${error.message}`)
            } else {
              robot.logger.error(`Unknown error: ${error}`)
            }
          }),
        ),
      )
      sentEmbeds.delete(message.id)
    }
  })
}
