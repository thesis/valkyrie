import { Client, TextChannel, Message } from "discord.js"
import { Robot } from "hubot"

const GOOGLE_API_KEY = process.env.GOOGLE_CLOUD_AI_KEY
if (!GOOGLE_API_KEY) {
  throw new Error("❌ Missing Google Cloud AI Key. Set GOOGLE_CLOUD_AI_KEY.")
}
// WIP and have disabled using GoogleGenerativeAI call since this was 
// kicking connection errors locally, use api endpoint for testing. 
// const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY)

async function summarizeMessages(text: string): Promise<string> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const data = await response.json()

    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return textResponse ?? "⚠️ No summary available."
  } catch (error: unknown) {
    console.error(
      "❌ AI Summarization Error:",
      error instanceof Error ? error.message : error,
    )
    return "⚠️ Failed to summarize the messages."
  }
}

async function sendLongMessage(channel: TextChannel, message: string) {
  const chunkSize = 2000
  for (let i = 0; i < message.length; i += chunkSize) {
    await channel.send(message.substring(i, i + chunkSize))
  }
}

export default function threadSummarizer(discordClient: Client, robot: Robot) {
  robot.logger.info("✅ AI Thread Summarizer script loaded.")

  robot.hear(/\/summarize/, async (msg) => {
    try {
      const threadId = msg.envelope.room
      if (!threadId) {
        msg.send("⚠️ This command must be used inside a thread.")
        return
      }

      const guild = discordClient.guilds.cache.first()
      if (!guild) {
        msg.send("⚠️ Failed to resolve Discord server.")
        return
      }

      const thread = (await guild.channels.fetch(threadId)) as TextChannel
      if (!thread || !thread.isTextBased()) {
        msg.send("⚠️ No matching thread found.")
        return
      }

      const messages = await thread.messages.fetch({ limit: 100 })
      if (!messages.size) {
        msg.send("⚠️ No messages found in this thread.")
        return
      }

      const formattedMessages = messages
        .map((m: Message) => `${m.author.username}: ${m.content}`)
        .reverse()
        .join("\n")

      msg.send("⏳ Summarizing thread messages...")

      const summary = await summarizeMessages(formattedMessages)

      if (summary.length > 2000) {
        await sendLongMessage(thread, `📜 **Thread Summary:**\n${summary}`)
      } else {
        await thread.send(`📜 **Thread Summary:**\n${summary}`)
      }
    } catch (error: unknown) {
      robot.logger.error(
        "❌ Error in /summarize command:",
        error instanceof Error ? error.message : error,
      )
      msg.send("⚠️ An error occurred while summarizing the thread.")
    }
  })
}
