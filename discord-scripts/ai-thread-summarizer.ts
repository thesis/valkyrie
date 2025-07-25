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
// import { GoogleGenAI } from "@google/genai";

const GOOGLE_API_KEY = process.env.GOOGLE_CLOUD_AI_KEY
if (!GOOGLE_API_KEY) {
  throw new Error(
    "❌ GOOGLE_CLOUD_AI_KEY is not defined. Please set the GOOGLE_CLOUD_AI_KEY environment variable.",
  )
}

const MAX_DISCORD_MESSAGE_LENGTH = 2000

// WIP and have disabled using GoogleGenAI call since this was
// causing core deps issues on top of
// kicking connection errors, used api endpoint for testing.
// const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY! })

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
    const response = await withRetries(robot, "call Gemini API", async () => {
      return await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
        {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-goog-api-key": GOOGLE_API_KEY!
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: "Summarize this conversation with specific bullet points on each different point of the conversation. Be sure to start with a summary of each member and what they said.",
                  },
                ],
              },
              { role: "user", parts: [{ text }] },
            ],
          }),
        },
      )
    })
    const data = await response.json()

    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return textResponse ?? "⚠️ No summary available."
  } catch (error: unknown) {
    robot.logger.error(
      "❌ AI Summarization Error:",
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
      "Failed to resolve Discord application, dropping AI Gemini handling.",
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
          "🧠 Do you want to use GeminiAI to summarize this thread?\n⚠️ DO NOT use this on sensitive data or information.",
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
