import { Robot } from "hubot"
import { Client, TextChannel } from "discord.js"
import { DAY, MILLISECOND, WEEK } from "../lib/globals.ts"

const EXTERNAL_AUDIT_CHANNEL_REGEXP = /^ext-(?<client>.*)-audit$/

async function createInvite(
  channel: TextChannel,
  maxAge = (1 * WEEK) / MILLISECOND,
  maxUses = 10,
): Promise<{ url: string; maxAge: number; maxUses: number }> {
  const invite = await channel.createInvite({
    maxAge,
    maxUses,
    unique: true,
  })

  return {
    url: invite.url,
    maxAge,
    maxUses,
  }
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    // Remove after using, just to clean all commands if n8n is there
    const existingCommands = await application.commands.fetch()
    const n8nCommandExists = existingCommands.some((cmd) => cmd.name === "n8n")

    if (n8nCommandExists) {
      await Promise.all(
        existingCommands.map((cmd) => application.commands.delete(cmd.id)),
      )
      robot.logger.info(
        "All old commands deleted because 'n8n' command was found",
      )
    } else {
      robot.logger.info("No n8n command found, no commands were deleted")
    }

    // Check if create-invite command already exists, if not create it
    const existingInviteCommand = (await application.commands.fetch()).find(
      (command) => command.name === "create-invite",
    )
    if (existingInviteCommand === undefined) {
      robot.logger.info("No create-invite command found, creating it!")
      await application.commands.create({
        name: "create-invite",
        description: "Creates a new invite",
      })
      robot.logger.info("create invite command set")
    }
    // Create an invite based of the command and channel where the command has been run
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "create-invite"
      ) {
        return
      }

      if (!interaction.guild) {
        await interaction.reply("This command can only be used in a server.")
        return
      }

      try {
        const { channel } = interaction
        if (channel instanceof TextChannel) {
          const invite = await createInvite(channel)
          if (invite) {
            await interaction.reply(
              `Here is your invite link: ${
                invite.url
              }\nThis invite expires in ${
                (invite.maxAge / DAY) * MILLISECOND
              } days and has a maximum of ${invite.maxUses} uses.`,
            )
          }
        } else {
          await interaction.reply(
            "Cannot create an invite for this type of channel.",
          )
        }
      } catch (error) {
        await interaction.reply("An error occurred while creating the invite.")
      }
    })

    // Generates an invite if the channel name matches ext-*-audit format
    discordClient.on("channelCreate", async (channel) => {
      if (
        channel.parent &&
        channel.parent.name === "defense" &&
        channel instanceof TextChannel &&
        EXTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name)
      ) {
        try {
          const defenseInvite = await createInvite(channel)
          if (defenseInvite) {
            robot.logger.info(
              `New invite created for defense audit channel: ${channel.name}, URL: ${defenseInvite.url}`,
            )
            channel.send(
              `Here is your invite link: ${
                defenseInvite.url
              }\nThis invite expires in ${
                (defenseInvite.maxAge / DAY) * MILLISECOND
              } days and has a maximum of ${defenseInvite.maxUses} uses.`,
            )
          }
          // Create a new role with the client name extracted and set permissions to that channel
          const clientName = channel.name
            .split("-")
            .slice(1, -1)
            .map(
              (segment) =>
                segment.substring(0, 1).toUpperCase() + segment.substring(1),
            )
            .join(" ")

          if (clientName) {
            const roleName = clientName
              ? `Defense: ${clientName}`
              : `Defense: ${channel.name}`

            const role = await channel.guild.roles.create({
              name: roleName,
              reason: `Role for ${channel.name} channel`,
            })

            await channel.permissionOverwrites.create(role, {
              ViewChannel: true,
            })
            channel.send(
              `**${role.name}** role created and permissions set for **${channel.name}**`,
            )
            robot.logger.info(
              `${role.name} role created and permissions set for channel ${channel.name}`,
            )
          } else {
            robot.logger.info(
              `Skipping role creation due to empty client name for channel ${channel.name}`,
            )
          }
        } catch (error) {
          robot.logger.error(
            `An error occurred setting up the defense audit channel: ${error}`,
          )
        }
      }
    })
  }
}
