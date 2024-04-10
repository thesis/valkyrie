import { Robot } from "hubot"
import {
  Client,
  AttachmentBuilder,
  TextChannel,
  Message,
  Collection,
} from "discord.js"
import { writeFile, unlink } from "fs/promises"
import dotenv from "dotenv"

dotenv.config()

async function fetchAllMessages(
  channel: TextChannel,
  before?: string,
): Promise<Collection<string, Message<true>>> {
  const limit = 100
  const options = before ? { limit, before } : { limit }
  const fetchedMessages = await channel.messages.fetch(options)

  if (fetchedMessages.size === 0) {
    return new Collection<string, Message<true>>()
  }

  const lastId = fetchedMessages.lastKey()
  const olderMessages = await fetchAllMessages(channel, lastId)

  return new Collection<string, Message<true>>().concat(
    fetchedMessages,
    olderMessages,
  )
}

export default async function archiveChannel(
  discordClient: Client,
  robot: Robot,
) {
  const { application } = discordClient

  if (application) {
    // Dump all messages from a channel into an array after "!archive"
    discordClient.on("messageCreate", async (message) => {
      if (
        message.content.toLowerCase() === "!archive" &&
        message.channel instanceof TextChannel
      ) {
        try {
          const allMessages = await fetchAllMessages(message.channel)

          robot.logger.info(`Total messages fetched: ${allMessages.size}`)

          const messagesArray = Array.from(allMessages.values()).reverse()
          const messagesContent = messagesArray
            .map(
              (m) =>
                `${m.createdAt.toLocaleString()}: ${m.author.username}: ${
                  m.content
                }`,
            )
            .join("\n")

          const filePath = "./messages.txt"
          await writeFile(filePath, messagesContent, "utf-8")

          const fileAttachment = new AttachmentBuilder(filePath)
          await message.channel
            .send({
              content: "Here are the archived messages:",
              files: [fileAttachment],
            })
            .then(() => unlink(filePath))
            .catch(robot.logger.error)
        } catch (error) {
          robot.logger.error(`An error occurred: ${error}`)
        }
      }
    })
  }
}
