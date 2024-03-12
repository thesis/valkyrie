import { Robot } from "hubot"
import { Client, TextChannel } from "discord.js"
import { WEEK } from "../lib/globals.ts"

const EXTERNAL_AUDIT_CHANNEL_REGEXP = /^ext-(?<client>.*)-audit$/

async function createInvite(
  discordClient: Client,
  channelId: string,
  maxAge = WEEK,
  maxUses = 10,
): Promise<string | null> {
  const channelForInvite = await discordClient.channels.fetch(channelId)

  if (channelForInvite === null || !("createInvite" in channelForInvite)) {
    throw new Error("Channel not found or access denied.")
  }

  const invite = await channelForInvite.createInvite({
    maxAge,
    maxUses,
    unique: true,
  })

  return invite.url
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    // Check if create-invite command already exists, if not create it
    const existingInviteCommand = (await application.commands.fetch()).find(
      (command) => command.name === "create-invite",
    )
    if (existingInviteCommand === undefined) {
      robot.logger.info("No create-invite command found, creating it!")
      await application.commands.set([
        {
          name: "create-invite",
          description: "Creates a new invite",
        },
      ])
      robot.logger.info("create invite command set")
    }
    // Create an invite based of the command and channel where the command has been run
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "create-invite"
      )
        return

      if (!interaction.guild) {
        await interaction.reply("This command can only be used in a server.")
        return
      }

      const maxAge = WEEK // default 7 days
      const maxUses = 10 // default 10 uses

      try {
        const { channel } = interaction
        if (channel instanceof TextChannel) {
          const invite = await channel.createInvite({
            maxAge,
            maxUses,
            unique: true,
          })
          await interaction.reply(
            `Here is your invite link: ${invite.url}\nThis invite expires in ${
              maxAge / (3600 * 24)
            } days and has a maximum of ${maxUses} uses.`,
          )
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
          const channelId = channel.id
          const maxAge = WEEK
          const maxUses = 10
          const inviteUrl = await createInvite(
            discordClient,
            channelId,
            maxAge,
            maxUses,
          )
          if (inviteUrl) {
            robot.logger.info(
              `New invite created for defense audit channel: ${channel.name}, URL: ${inviteUrl}`,
            )
            channel.send(
              `Here is your invite link: ${inviteUrl}\n` +
                `This invite expires in ${
                  maxAge / (3600 * 24)
                } days and has a maximum of ${maxUses} uses.`,
            )
          }
          // Create a new role with the client name extracted and set permissions to that channel
          const auditChannel = channel.name.split("-")
          const clientName = auditChannel[0].includes("🔒")
            ? auditChannel[1]
            : ""
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
        } catch (error) {
          robot.logger.error(
            `An error occurred setting up the defense audit channel: ${error}`,
          )
        }
      }
    })
  }
}
