import { Robot } from "hubot"
import {
  Client,
  TextChannel,
  ChannelType,
  AttachmentBuilder,
  Collection,
  Message,
} from "discord.js"
import { writeFile, unlink } from "fs/promises"

// fetch messages in batch of 100 in-order to go past rate limit.
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
    // check if archive-channel command already exists, if not create it
    const existingArchiveCommand = (await application.commands.fetch()).find(
      (command) => command.name === "archive-channel",
    )
    if (existingArchiveCommand === undefined) {
      robot.logger.info("No archive-channel command found, creating it!")
      await application.commands.create({
        name: "archive-channel",
        description:
          "Archives channel to archived channels category (Defense only)",
      })
      robot.logger.info("archive channel command set")
    }

    // check if unarchive-channel command already exists, if not create it
    const existingUnarchiveCommand = (await application.commands.fetch()).find(
      (command) => command.name === "unarchive-channel",
    )
    if (existingUnarchiveCommand === undefined) {
      robot.logger.info("No unarchive-channel command found, creating it!")
      await application.commands.create({
        name: "unarchive-channel",
        description:
          "unarchive channel back to defense category (Defense only)",
      })
      robot.logger.info("unarchive channel command set")
    }

    // move channel to archived-channel category and send out transcript to interaction
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "archive-channel"
      ) {
        return
      }
      if (!interaction.guild || !(interaction.channel instanceof TextChannel)) {
        return
      }

      try {
        const allMessages = await fetchAllMessages(interaction.channel)
        robot.logger.info(`Total messages fetched: ${allMessages}`)

        const messagesContent = allMessages
          .reverse()
          .map(
            (m) =>
              `${m.createdAt.toLocaleString()}: ${m.author.username}: ${
                m.content
              }`,
          )
          .join("\n")

        const filePath = `${interaction.channel.name}_transcript.txt`
        await writeFile(filePath, messagesContent, "utf-8")

        // check for or create archived category
        let archivedCategory = interaction.guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase() === "archived-channels",
        )
        if (!archivedCategory) {
          archivedCategory = await interaction.guild.channels.create({
            name: "archived-channels",
            type: ChannelType.GuildCategory,
          })
        }

        // move channel and set permissions
        if (archivedCategory) {
          await interaction.channel.setParent(archivedCategory.id)
          await interaction.channel.permissionOverwrites.edit(
            interaction.guild.id,
            { SendMessages: false },
          )
          await interaction.reply(
            "**Channel archived, locked and moved to #archived-channel category**",
          )

          // upload chat transcript to channel and then delete it
          const fileAttachment = new AttachmentBuilder(filePath)
          await interaction.channel
            .send({
              content: "**Here is a transcript of the channel messages:**",
              files: [fileAttachment],
            })
            .then(() => unlink(filePath))
            .catch((error) =>
              robot.logger.error(`Failed to delete file: ${error}`),
            )

          robot.logger.info(
            "Channel archived and locked successfully, messages saved.",
          )
        }
      } catch (error) {
        robot.logger.error(`An error occurred: ${error}`)
      }
    })

    // move channel back to defense category on Unarchived
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "unarchive-channel"
      ) {
        return
      }
      if (!interaction.guild) {
        return
      }
      try {
        if (interaction.channel instanceof TextChannel) {
          const defenseCategory = interaction.guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildCategory &&
              c.name.toLowerCase() === "defense",
          )

          if (!defenseCategory) {
            await interaction.reply(
              "No defense category found to move channel to",
            )
          }

          if (defenseCategory) {
            await interaction.channel.setParent(defenseCategory.id)
            await interaction.channel.permissionOverwrites.edit(
              interaction.guild.id,
              { SendMessages: false },
            )
            await interaction.reply(
              "**Channel unarchived and move backed to defense category**",
            )
            robot.logger.info("Channel unarchived and moved.")
          }
        }
      } catch (error) {
        robot.logger.error(`An error occurred: ${error}`)
      }
    })
  }
}
