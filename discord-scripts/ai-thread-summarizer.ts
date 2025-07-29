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
                content: `Please provide a comprehensive and precise summary of this Discord thread conversation. Follow this structure:

## Participants Summary
- List each participant and their key contributions/viewpoints

## Main Discussion Points
- Identify and summarize each distinct topic or issue discussed
- Include any decisions made or conclusions reached
- Note any unresolved questions or ongoing debates

## Key Takeaways
- Highlight the most important insights or outcomes
- Include any action items or next steps mentioned

## Context & Tone
- Brief note on the overall tone and context of the discussion

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

      const formattedMessages = messages
        .map((m: Message) => `${m.author.username}: ${m.content}`)
        .reverse()
        .join("\n")

      const summary = await summarizeMessages(robot, formattedMessages)

      if (summary.length > MAX_DISCORD_MESSAGE_LENGTH) {
        await sendLongMessage(thread, `📜 **Thread Summary:**\n${summary}`)
      } else {
        await thread.send(`📜 **Thread Summary:**\n${summary}`)
      }

      await interaction.followUp({
        content: "✅ Summary complete!",
        ephemeral: true,
      })
    }
  })
}
