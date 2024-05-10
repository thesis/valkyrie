import { Robot } from "hubot"
import {
  Client,
  AuditLogEvent,
  AttachmentBuilder,
  TextChannel,
  ChannelType,
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
    // Dump all messages into a text file and then move channel to it's own category "archived-messages"
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

          if (!message.guild) {
            robot.logger.error(
              "This command cannot be executed outside of a guild.",
            )
            return
          }

          let archivedCategory = discordClient.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildCategory &&
              c.name.toLowerCase() === "archived-channels",
          )
          if (!archivedCategory) {
            if (message.guild && archivedCategory) {
              archivedCategory = await message.guild.channels.create({
                name: "archived-channels",
                type: ChannelType.GuildCategory,
              })
              await message.channel.setParent(archivedCategory.id)
              await message.channel.send("Channel archived")
            }
          }

          if (archivedCategory) {
            await message.channel.setParent(archivedCategory.id)
            await message.channel.permissionOverwrites.edit(message.guild.id, {
              SendMessages: false,
            })
            await message.channel.send(
              "Channel archived, locked and moved to archived channel category",
            )
            robot.logger.info("Channel archived and locked successfully.")
          }
        } catch (error) {
          robot.logger.error(`An error occurred: ${error}`)
        }
      }
    })

    // WIP, just for debugging in order to track auditlog events, update: it does not seem as though parent.id changes are stored
    discordClient.on("messageCreate", async (message) => {
      if (
        message.content.toLowerCase() === "!unarchive" &&
        message.channel instanceof TextChannel &&
        message.guild
      ) {
        try {
          const logs = await message.guild.fetchAuditLogs({
            type: AuditLogEvent.ChannelUpdate,
            limit: 100,
          })
          const latestEntries = Array.from(logs.entries.values()).slice(0, 50)
          latestEntries.forEach((entry) => {
            if (entry.changes) {
              entry.changes.forEach((change) => {
                robot.logger.info(
                  `Change Key: ${change.key}, Old Value: ${change.old}, New Value: ${change.new}`,
                )
              })
            }
          })
        } catch (error) {
          robot.logger.error(
            `An error occurred while trying to unarchive the channel: ${error}`,
          )
          message.channel.send("Failed to unarchive the channel.")
        }
      }
    })
  }
}
