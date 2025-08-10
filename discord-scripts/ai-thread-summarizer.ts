import {
  Client,
  TextChannel,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ThreadChannel,
} from "discord.js"
import { Robot } from "hubot"

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) {
  throw new Error(
    "❌ ANTHROPIC_API_KEY is not defined. Please set the ANTHROPIC_API_KEY environment variable.",
  )
}

const MAX_DISCORD_MESSAGE_LENGTH = 2000

// Using Claude API directly for better precision and reliability

async function withRetries<T>(
  robot: Robot,
  description: string,
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const stackString =
      "stack" in (error as Error) && (error as Error).stack !== undefined
        ? `; ${(error as Error).stack}`
        : ""

    if (retries === 1) {
      throw new Error(
        `Failed to ${description} too many times, aborted; last error was:\n${JSON.stringify(
          error,
          null,
          2,
        )}${stackString}`,
      )
    } else {
      robot.logger.warning(
        `Failed to ${description}, retrying...\n`,
        JSON.stringify(error, null, 2),
        `${stackString}`,
      )

      return await withRetries(robot, description, fn, retries - 1)
    }
  }
}

async function summarizeMessages(robot: Robot, text: string): Promise<string> {
  try {
    const response = await withRetries(robot, "call Claude API", async () => {
      return await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 2048,
            messages: [
              {
                role: "user",
                content: `Please provide a concise summary of this Discord thread conversation. Avoid numbered lists and use nested bullets under numbered lists. Follow this structure:

## Participants Summary
- List each participant and their key contributions/viewpoints
- If Discord tags are provided in the participant information below, include them next to each participant's name (e.g., "username (<@123456789>)")

## Main Discussion Points
- Identify and summarize each distinct topic or issue discussed
- Include any decisions made or conclusions reached
- Note any unresolved questions or ongoing debates

## Key Takeaways & Action Items
- Highlight the most important insights or outcomes
- Include any action items or next steps mentioned

Here's the conversation to summarize:

${text}`
              }
            ]
          }),
        },
      )
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
    }
    
    const data = await response.json()
    const textResponse = data?.content?.[0]?.text
    return textResponse ?? "⚠️ No summary available."
  } catch (error: unknown) {
    robot.logger.error(
      "❌ Claude AI Summarization Error:",
      error instanceof Error ? error.message : error,
    )
    return "⚠️ Failed to summarize the messages."
  }
}

async function getUserIdByUsername(
  discordClient: Client,
  guildId: string,
  username: string,
): Promise<string | null> {
  const guild = discordClient.guilds.cache.get(guildId)
  if (!guild) return null

  await guild.members.fetch()

  const matchedMember = guild.members.cache.find((member) =>
    member.user.username === username || member.displayName === username
  )

  return matchedMember ? matchedMember.user.id : null
}

async function getUniqueParticipants(messages: Message[]): Promise<Set<string>> {
  const participants = new Set<string>()
  messages.forEach((message) => {
    if (!message.author.bot) {
      participants.add(message.author.username)
    }
  })
  return participants
}

async function sendLongMessage(channel: TextChannel | ThreadChannel, message: string) {
  const chunkSize = MAX_DISCORD_MESSAGE_LENGTH
  for (let i = 0; i < message.length; i += chunkSize) {
    await channel.send(message.substring(i, i + chunkSize))
  }
}

export default async function threadSummarizer(
  discordClient: Client,
  robot: Robot,
) {
  robot.logger.info("✅ AI Thread Summarizer script loaded.")

  const { application } = discordClient
  if (application === null) {
    robot.logger.error(
      "Failed to resolve Discord application, dropping AI Claude handling.",
    )
    return
  }

  const existingSummaryCommand = (
    await withRetries(robot, "fetch Discord commands", () =>
      application.commands.fetch(),
    )
  ).find((command) => command.name === "summary")

  if (existingSummaryCommand === undefined) {
    robot.logger.info("No summary command yet, creating it!")
    await application.commands.create({
      name: "summary",
      description: "Generate an AI powered summary of a thread",
    })

    robot.logger.info("Created AI command.")
  }

  discordClient.on("interactionCreate", async (interaction) => {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "summary" &&
      interaction.channel !== null &&
      !interaction.channel.isDMBased()
    ) {
      if (!interaction.channel.isThread()) {
        await interaction.reply({
          content:
            "⚠️ The `/summary` command can only be used inside a thread.",
          ephemeral: true,
        })
        return
      }
      const thread = interaction.channel

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_summary")
          .setLabel("Confirm")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("cancel_summary")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      )

      await interaction.reply({
        content:
          "🧠 Do you want to use Claude AI to summarize this thread?\n⚠️ DO NOT use this on sensitive data or information.",
        components: [row],
        ephemeral: true,
      })

      const confirmation = await interaction.channel
        ?.awaitMessageComponent({
          componentType: ComponentType.Button,
          time: 15000,
          filter: (i) => i.user.id === interaction.user.id,
        })
        .catch(() => null)

      if (!confirmation || confirmation.customId === "cancel_summary") {
        await interaction.followUp({
          content: "❌ Summary cancelled.",
          ephemeral: true,
        })
        return
      }

      await confirmation.update({
        content: "⏳ Summarizing thread messages...",
        components: [],
      })

      const messages = await thread.messages.fetch({ limit: 100 })
      if (!messages.size) {
        await thread.send("⚠️ No messages found in this thread.")
        return
      }

      const messagesArray = Array.from(messages.values())
      const participants = await getUniqueParticipants(messagesArray)
      
      // Get user IDs for tagging
      const guildId = thread.guildId
      const userTags: string[] = []
      const participantMappings: { [username: string]: string } = {}
      
      if (guildId) {
        for (const username of participants) {
          const userId = await getUserIdByUsername(discordClient, guildId, username)
          if (userId) {
            const tag = `<@${userId}>`
            userTags.push(tag)
            participantMappings[username] = tag
          }
        }
      }

      const formattedMessages = messagesArray
        .map((m: Message) => `${m.author.username}: ${m.content}`)
        .reverse()
        .join("\n")

      const participantInfo = Array.from(participants).map(username => {
        const tag = participantMappings[username]
        return tag ? `${username} (${tag})` : username
      }).join(", ")

      const summary = await summarizeMessages(robot, `${formattedMessages}\n\n--- PARTICIPANT TAGS FOR SUMMARY ---\nParticipants with Discord tags: ${participantInfo}`)
      
      const taggedUsersText = userTags.length > 0 ? `\n\n👥 **Participants:** ${userTags.join(" ")}` : ""
      const fullSummary = `📜 **Thread Summary:**\n${summary}${taggedUsersText}`

      if (fullSummary.length > MAX_DISCORD_MESSAGE_LENGTH) {
        await sendLongMessage(thread, fullSummary)
      } else {
        await thread.send(fullSummary)
      }

      await interaction.followUp({
        content: "✅ Summary complete!",
        ephemeral: true,
      })
    }
  })
}
