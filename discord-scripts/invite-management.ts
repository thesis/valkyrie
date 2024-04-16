import { Robot } from "hubot"
import {
  ApplicationCommandOptionType,
  Client,
  ChannelType,
  TextChannel,
  GuildMember,
} from "discord.js"
import { DAY, MILLISECOND, WEEK } from "../lib/globals.ts"

const guildInvites: { [guildId: string]: { [inviteCode: string]: number } } = {}

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

async function listInvites(discordClient: Client, robot: Robot): Promise<void> {
  discordClient.guilds.cache.forEach(async (guild) => {
    try {
      const fetchInvites = await guild.invites.fetch()
      if (fetchInvites) {
        guildInvites[guild.id] = guildInvites[guild.id] || {}

        fetchInvites.forEach((invite) => {
          guildInvites[guild.id][invite.code] = invite.uses ?? 0
        })
      }
    } catch (error) {
      robot.logger.error(
        `Failed to fetch invites for guild ${guild.name}: ${error}`,
      )
    }
  })
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    // stores a list of all invites on runtime
    setTimeout(async () => {
      await listInvites(discordClient, robot)
    }, 1000)

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

    // Check if defense-audit command exists, if not create it
    const existingDefenseCommand = (await application.commands.fetch()).find(
      (command) => command.name === "defense-audit2",
    )
    if (existingDefenseCommand === undefined) {
      robot.logger.info("No defense-audit command found, creating it!")
      await application.commands.create({
        name: "defense-audit",
        description: "Creates Defense audit channels",
        options: [
          {
            name: "audit-name",
            type: ApplicationCommandOptionType.String,
            description:
              "The name of the audit/client to create the channels for.",
            required: true,
          },
        ],
      })
      robot.logger.info("Defense audit command set")
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

    // Create the defense audit channels and roles based off the command
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "defense-audit"
      ) {
        return
      }

      if (!interaction.guild) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          ephemeral: true,
        })
        return
      }

      if (
        !interaction.guild ||
        !(interaction.channel instanceof TextChannel) ||
        (interaction.channel.parent &&
          interaction.channel.parent.name !== "defense")
      ) {
        await interaction.reply({
          content:
            "This command can only be run in chat channels under the 'Defense' category.",
          ephemeral: true,
        })
        return
      }

      const clientName = interaction.options.get("audit-name")
      if (!clientName) {
        await interaction.reply({
          content: "Client name is required for the defense-audit command.",
          ephemeral: true,
        })
        return
      }

      try {
        if (typeof clientName.value === "string") {
          await interaction.deferReply({ ephemeral: true })
          const normalizedClientName = clientName.value
            .replace(/[^a-zA-Z0-9]/g, "-")
            .toLowerCase()
          const internalChannelName = `🔒int-${normalizedClientName}-audit`
          const externalChannelName = `🔒ext-${normalizedClientName}-audit`

          const defenseCategory = interaction.guild.channels.cache.find(
            (category) => category.name === "defense",
          )

          if (!defenseCategory) {
            await interaction.reply({
              content: "Defense category does not exist.",
              ephemeral: true,
            })
            return
          }

          // Internal channel setup
          let internalChannel = interaction.guild.channels.cache.find(
            (channel) => channel.name === internalChannelName,
          ) as TextChannel
          const internalChannelCreated = !internalChannel
          if (internalChannelCreated) {
            internalChannel = await interaction.guild.channels.create({
              name: internalChannelName,
              type: ChannelType.GuildText,
              parent: defenseCategory.id,
            })
          }

          const internalRoleName = `Defense Internal: ${clientName.value}`
          let internalRole = interaction.guild.roles.cache.find(
            (r) => r.name === internalRoleName,
          )
          if (!internalRole) {
            internalRole = await interaction.guild.roles.create({
              name: internalRoleName,
              reason: "Role for internal audit channel",
            })
          }

          if (internalChannel) {
            await internalChannel.permissionOverwrites.create(internalRole, {
              ViewChannel: true,
            })
            await internalChannel.send(
              `@here **Welcome to the ${clientName.value} Internal Audit Channel!**`,
            )
          }
          const internalInvite = await createInvite(internalChannel)

          // External channel setup
          let externalChannel = interaction.guild.channels.cache.find(
            (channel) => channel.name === externalChannelName,
          ) as TextChannel
          const externalChannelCreated = !externalChannel
          if (externalChannelCreated) {
            externalChannel = await interaction.guild.channels.create({
              name: externalChannelName,
              type: ChannelType.GuildText,
              parent: defenseCategory.id,
            })
          }

          const externalRoleName = `Defense External: ${clientName.value}`
          let externalRole = interaction.guild.roles.cache.find(
            (r) => r.name === externalRoleName,
          )
          if (!externalRole) {
            externalRole = await interaction.guild.roles.create({
              name: externalRoleName,
              reason: "Role for external audit channel",
            })
          }

          if (externalChannel) {
            await externalChannel.permissionOverwrites.create(externalRole, {
              ViewChannel: true,
            })
            await externalChannel.permissionOverwrites.create(internalRole, {
              ViewChannel: true,
            })
            await externalChannel.send(
              `@here **Welcome to the ${clientName.value} External Audit Channel!**`,
            )
          }
          const externalInvite = await createInvite(externalChannel)

          // Final interaction response
          if (internalChannelCreated || externalChannelCreated) {
            await interaction.editReply({
              content:
                `**Defense audit setup complete for: ${clientName.value}**\n\n` +
                `Internal Channel: <#${internalChannel.id}> - Invite: \`${internalInvite.url}\`\n` +
                `External Channel: <#${externalChannel.id}> - Invite: \`${externalInvite.url}\`\n\n` +
                `Roles created: <@&${internalRole.id}>, <@&${externalRole.id}>`,
            })
          } else {
            await interaction.editReply({
              content:
                `**Defense audit channels already set up for: ${clientName.value}**\n\n` +
                "These channels were found here:\n" +
                `- Internal Channel: <#${internalChannel.id}> - Invite: \`${internalInvite.url}\`\n` +
                `- External Channel: <#${externalChannel.id}> - Invite: \`${externalInvite.url}\`\n\n` +
                "We've updated permissions to these roles:\n" +
                `- Internal Role: <@&${internalRole.id}>\n` +
                `- External Role: <@&${externalRole.id}>`,
            })
          }
        }
      } catch (error) {
        robot.logger.error(error)
        await interaction.reply({
          content: "An error occurred while setting up the defense audit.",
          ephemeral: true,
        })
      }
    })

    // Check list of invites and compare when a new user joins which invite code has been used, then assign role based on channel.name.match TO DO: Modify this to work with potentially all invites
    discordClient.on("guildMemberAdd", async (member: GuildMember) => {
      const oldInvites = guildInvites[member.guild.id] || {}
      const fetchedInvites = await member.guild.invites.fetch()

      const newInvites: { [code: string]: number } = {}
      fetchedInvites.forEach((invite) => {
        newInvites[invite.code] = invite.uses ?? 0
      })

      guildInvites[member.guild.id] = newInvites

      const usedInvite = fetchedInvites.find((fetchedInvite) => {
        const oldUses = oldInvites[fetchedInvite.code] || 0
        return (fetchedInvite.uses ?? 0) > oldUses
      })

      if (usedInvite && usedInvite.channelId) {
        const channel = member.guild.channels.cache.get(
          usedInvite.channelId,
        ) as TextChannel
        if (channel) {
          const channelTypeMatch = channel.name.match(/(ext|int)-(.*)-audit/)
          const clientName = channelTypeMatch
            ? channelTypeMatch[2]
                .replace(/-/g, " ")
                .split(" ")
                .map(
                  (word) =>
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
                )
                .join(" ")
            : ""

          if (channelTypeMatch) {
            const auditType =
              channelTypeMatch[1] === "ext" ? "External" : "Internal"
            const roleName = `Defense ${auditType}: ${clientName}`

            const role = member.guild.roles.cache.find(
              (r) => r.name.toLowerCase() === roleName.toLowerCase(),
            )
            if (role) {
              await member.roles.add(role)
            }
            robot.logger.info(
              `Invite code used: ${
                usedInvite ? usedInvite.code : "None"
              }, Username joined: ${
                member.displayName
              }, Role assignments: ${roleName}`,
            )
          }
        }
      } else {
        robot.logger.info("Could not find which invite was used.")
      }
    })
  }
}
