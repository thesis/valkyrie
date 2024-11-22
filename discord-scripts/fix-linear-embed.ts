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
  channel: TextChannel | ThreadChannel | VoiceChannel,
  logger: Log,
  linearClient: LinearClient,
) {
  const issueUrlRegex =
    /https:\/\/linear\.app\/([a-zA-Z0-9-]+)\/issue\/([a-zA-Z0-9-]+)(?:.*#comment-([a-zA-Z0-9]+))?/g

  const matches = Array.from(message.matchAll(issueUrlRegex))

  if (matches.length === 0) {
    return
  }

  const embedPromises = matches.map(async (match) => {
    const teamName = match[1]
    const issueId = match[2]
    const commentId = match[3] || undefined

    logger.info(
      `Processing team: ${teamName}, issue: ${issueId}, comment: ${commentId}`,
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

  results.forEach(({ embed, issueId }) => {
    if (embed) {
      channel
        .send({ embeds: [embed] })
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

export default function linearEmbeds(discordClient: Client, robot: Robot) {
  const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })

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

    robot.logger.info(`Processing message: ${message.content}`)
    await processLinearEmbeds(
      message.content,
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

    robot.logger.info(
      `Processing updated message: ${newMessage.content} (was: ${oldMessage?.content})`,
    )
    await processLinearEmbeds(
      newMessage.content,
      newMessage.channel,
      robot.logger,
      linearClient,
    )
  })
}
