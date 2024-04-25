import { Robot } from "hubot"
import { Client, TextChannel, ChannelType } from "discord.js"

export default async function archiveChannel(
  discordClient: Client,
  robot: Robot,
) {
  const { application } = discordClient

  if (application) {
    // Check if archive-channel command already exists, if not create it
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

    // Check if unarchive-channel command already exists, if not create it
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

    // Move channel to archived-channel category
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "archive-channel"
      ) {
        return
      }
      if (!interaction.guild) {
        await interaction.reply("This command can only be used in a server.")
        return
      }
      try {
        if (interaction.channel instanceof TextChannel) {
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

          if (archivedCategory) {
            ;(await interaction.channel.setParent(
              archivedCategory.id,
            )) as TextChannel
            await interaction.channel.permissionOverwrites.edit(
              interaction.guild.id,
              {
                SendMessages: false,
              },
            )
            await interaction.channel.send(
              "Channel archived, locked and moved to archived channel category",
            )
            robot.logger.info("Channel archived and locked successfully.")
          }
        }
      } catch (error) {
        robot.logger.error(`An error occurred: ${error}`)
        await interaction.reply(
          `An error occurred: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        )
      }
    })

    // Move channel back to defense category on Unarchived
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "unarchive-channel"
      ) {
        return
      }
      if (!interaction.guild) {
        await interaction.reply("This command can only be used in a server.")
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
            ;(await interaction.channel.setParent(
              defenseCategory.id,
            )) as TextChannel
            await interaction.channel.permissionOverwrites.edit(
              interaction.guild.id,
              {
                SendMessages: false,
              },
            )
            await interaction.channel.send(
              "Channel unarchived and move backed to defense category",
            )
            robot.logger.info("Channel uarchived and moved.")
          }
        }
      } catch (error) {
        robot.logger.error(`An error occurred: ${error}`)
        await interaction.reply(
          `An error occurred: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        )
      }
    })
  }
}
