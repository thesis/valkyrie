import { Robot } from "hubot"
import {
  ApplicationCommandOptionType,
  Client,
  ChannelType,
  Collection,
  TextChannel,
  GuildMember,
} from "discord.js"
import { DAY, MILLISECOND, WEEK } from "../lib/globals.ts"

// const EXTERNAL_AUDIT_CHANNEL_REGEXP = /^ext-(?<client>.*)-audit$/
// const INTERNAL_AUDIT_CHANNEL_REGEXP = /^int-(?<client>.*)-audit$/
const guildInvites = new Collection()

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
    const fetchInvites = await guild.invites.fetch().catch((error) => {
      robot.logger.error(
        `Failed to fetch invites for guild ${guild.name}: ${error}`,
      )
    })

    if (fetchInvites) {
      guildInvites.set(
        guild.id,
        new Collection(
          fetchInvites.map((invite) => [invite.code, invite.uses]),
        ),
      )
      // just for debugging
      robot.logger.info(
        `List all guild invites for ${guild.name}:`,
        guildInvites.get(guild.id),
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
      (command) => command.name === "defense-audit",
    )
    if (existingDefenseCommand === undefined) {
      robot.logger.info("No defense-audit command found, creating it!")
      await application.commands.create({
        name: "defense-audit",
        description: "Creates Defense audit channels",
        options: [
          {
            name: "client-name",
            type: ApplicationCommandOptionType.String,
            description: "The name of the client to create the channels for",
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

      const clientName = interaction.options.get("client-name")
      if (!clientName) {
        await interaction.reply({
          content: "Client name is required for the defense-audit command.",
          ephemeral: true,
        })
        return
      }

      try {
        if (typeof clientName.value === "string") {
          const normalizedClientName = clientName.value
            .replace(/\s+/g, "-")
            .toLowerCase()
          const internalChannelName = `int-${normalizedClientName}-audit`
          const externalChannelName = `ext-${normalizedClientName}-audit`

          const defenseCategory = interaction.guild.channels.cache.find(
            (c) => c.name === "defense",
          )

          if (!defenseCategory) {
            await interaction.reply({
              content: "Defense category does not exist.",
              ephemeral: true,
            })
            return
          }

          const internalChannel = await interaction.guild.channels.create({
            name: internalChannelName,
            type: ChannelType.GuildText,
            parent: defenseCategory.id,
          })

          const externalChannel = await interaction.guild.channels.create({
            name: externalChannelName,
            type: ChannelType.GuildText,
            parent: defenseCategory.id,
          })

          const internalRoleName = `Defense Internal: ${clientName.value}`
          const externalRoleName = `Defense External: ${clientName.value}`
          const internalRole = await interaction.guild.roles.create({
            name: internalRoleName,
            reason: "Role for internal audit channel",
          })
          const externalRole = await interaction.guild.roles.create({
            name: externalRoleName,
            reason: "Role for external audit channel",
          })

          await internalChannel.permissionOverwrites.create(internalRole, {
            ViewChannel: true,
          })
          await externalChannel.permissionOverwrites.create(externalRole, {
            ViewChannel: true,
          })
          await externalChannel.permissionOverwrites.create(internalRole, {
            ViewChannel: true,
          })

          const internalInvite = await createInvite(internalChannel)
          const externalInvite = await createInvite(externalChannel)

          await interaction.reply({
            content: `Defense audit setup complete for: ${clientName}\n\nInternal Channel Invite: ${internalInvite.url}\nExternal Channel Invite: ${externalInvite.url}`,
            ephemeral: true,
          })
        }
      } catch (error) {
        robot.logger.error(error)
        await interaction.reply({
          content: "An error occurred while setting up the defense audit.",
          ephemeral: true,
        })
      }
    })

    // // Generates an invite if the channel name matches ext-*-audit format
    // discordClient.on("channelCreate", async (channel) => {
    //   if (
    //     channel.parent &&
    //     channel.parent.name === "defense" &&
    //     channel instanceof TextChannel &&
    //     (EXTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name) ||
    //       INTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name))
    //   ) {
    //     const auditChannelType: string = EXTERNAL_AUDIT_CHANNEL_REGEXP.test(
    //       channel.name,
    //     )
    //       ? "External"
    //       : "Internal"
    //     try {
    //       const defenseInvite = await createInvite(channel)
    //       if (defenseInvite) {
    //         robot.logger.info(
    //           `New invite created for defense ${auditChannelType.toLowerCase()} audit channel: ${
    //             channel.name
    //           }, URL: ${defenseInvite.url}`,
    //         )
    //         channel.send(
    //           `Here is your invite link: ${
    //             defenseInvite.url
    //           }\nThis invite expires in ${
    //             (defenseInvite.maxAge / DAY) * MILLISECOND
    //           } days and has a maximum of ${defenseInvite.maxUses} uses.`,
    //         )
    //       }
    //       // store new invites
    //       await listInvites(discordClient, robot)

    //       // Create a new role with the client name extracted and set permissions to that channel
    //       const clientName = channel.name
    //         .split("-")
    //         .slice(1, -1)
    //         .map(
    //           (segment) =>
    //             segment.substring(0, 1).toUpperCase() + segment.substring(1),
    //         )
    //         .join(" ")

    //       if (clientName) {
    //         const roleName = `Defense ${auditChannelType}: ${
    //           clientName || channel.name
    //         }`

    //         const role = await channel.guild.roles.create({
    //           name: roleName,
    //           reason: `Role for ${channel.name} channel`,
    //         })

    //         await channel.permissionOverwrites.create(role, {
    //           ViewChannel: true,
    //         })

    //         if (auditChannelType === "Internal") {
    //           const normalizedClientName = clientName
    //             .replace(/\s+/g, "-")
    //             .toLowerCase()
    //           const externalAuditChannel = channel.guild.channels.cache.find(
    //             (c) =>
    //               c.name === `🔒ext-${normalizedClientName}-audit` &&
    //               c.parent &&
    //               c.parent.name === "defense",
    //           ) as TextChannel

    //           if (externalAuditChannel) {
    //             await externalAuditChannel.permissionOverwrites.create(
    //               role.id,
    //               {
    //                 ViewChannel: true,
    //               },
    //             )
    //             channel.send(
    //               `**${role.name}** role granted ViewChannel access to the external audit channel **${externalAuditChannel.name}**`,
    //             )
    //             robot.logger.info(
    //               `ViewChannel access granted to ${role.name} for external audit channel ${externalAuditChannel.name}`,
    //             )
    //           } else {
    //             channel.send("No matching external audit channel found.")
    //             robot.logger.info(
    //               "No matching external audit channel found for " +
    //                 `ext-${clientName.toLowerCase()}-audit`,
    //             )
    //           }
    //         }

    //         channel.send(
    //           `**${role.name}** role created and permissions set for **${channel.name}**`,
    //         )
    //         robot.logger.info(
    //           `${role.name} role created and permissions set for channel ${channel.name}`,
    //         )
    //       } else {
    //         robot.logger.info(
    //           `Skipping role creation due to empty client name for channel ${channel.name}`,
    //         )
    //       }
    //     } catch (error) {
    //       robot.logger.error(
    //         `An error occurred setting up the defense ${auditChannelType.toLowerCase()} audit channel: ${error}`,
    //       )
    //     }
    //   }
    // })

    // WIP, just testing out invite counting in order to verify which invite was used on join
    discordClient.on("guildMemberAdd", async (member: GuildMember) => {
      // for debugging
      robot.logger.info(member)

      const oldInvites =
        (guildInvites.get(member.guild.id) as Collection<
          string,
          { uses: number }
        >) || new Collection<string, { uses: number }>()
      const fetchedInvites = await member.guild.invites.fetch()
      const newInvites = new Collection<string, number>(
        fetchedInvites.map((invite) => [invite.code, invite.uses ?? 0]),
      )
      guildInvites.set(member.guild.id, newInvites)

      robot.logger.info(
        `Old Invites: ${JSON.stringify(Array.from(oldInvites.entries()))}`,
      )
      robot.logger.info(
        `New Invites: ${JSON.stringify(Array.from(newInvites.entries()))}`,
      )

      const usedInvite = fetchedInvites.find((fetchedInvite) => {
        const oldInvite = oldInvites.get(fetchedInvite.code)
        const oldUses =
          typeof oldInvite === "object" ? oldInvite.uses : oldInvite
        return (fetchedInvite.uses ?? 0) > (oldUses ?? 0)
      })

      robot.logger.info(`Used Invite: ${usedInvite ? usedInvite.code : "None"}`)

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

          robot.logger.info(`Channel Name: ${channel.name}`)

          if (channelTypeMatch) {
            const auditType =
              channelTypeMatch[1] === "ext" ? "External" : "Internal"
            robot.logger.info(`Audit Channel Type: ${auditType}`)
            const roleName = `Defense ${auditType}: ${clientName}`

            const role = member.guild.roles.cache.find(
              (r) => r.name.toLowerCase() === roleName.toLowerCase(),
            )

            if (role) {
              await member.roles.add(role)
              robot.logger.info(
                `Assigned role ${roleName} to ${member.displayName}`,
              )
            } else {
              robot.logger.info(`Role ${roleName} not found in guild.`)
            }
          }
        }
      } else {
        robot.logger.info("Could not find which invite was used.")
      }
    })
  }
}
