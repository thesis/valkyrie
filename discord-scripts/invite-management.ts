import { Robot } from "hubot"
import { Client, Collection, TextChannel, GuildMember } from "discord.js"
import { DAY, MILLISECOND, WEEK } from "../lib/globals.ts"

const EXTERNAL_AUDIT_CHANNEL_REGEXP = /^ext-(?<client>.*)-audit$/
const INTERNAL_AUDIT_CHANNEL_REGEXP = /^int-(?<client>.*)-audit$/
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
    const fetchInvites = await guild.invites.fetch().catch(error => {
      robot.logger.error(`Failed to fetch invites for guild ${guild.name}: ${error}`)
    })

    if (fetchInvites) {
      guildInvites.set(guild.id, new Collection(fetchInvites.map(invite => [invite.code, invite.uses])))
      // just for debugging
      robot.logger.info(`List all guild invites for ${guild.name}:`, guildInvites.get(guild.id))
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
        (EXTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name) ||
          INTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name))
      ) {
        const auditChannelType: string = EXTERNAL_AUDIT_CHANNEL_REGEXP.test(
          channel.name,
        )
          ? "External"
          : "Internal"
        try {
          const defenseInvite = await createInvite(channel)
          if (defenseInvite) {
            robot.logger.info(
              `New invite created for defense ${auditChannelType.toLowerCase()} audit channel: ${
                channel.name
              }, URL: ${defenseInvite.url}`,
            )
            channel.send(
              `Here is your invite link: ${
                defenseInvite.url
              }\nThis invite expires in ${
                (defenseInvite.maxAge / DAY) * MILLISECOND
              } days and has a maximum of ${defenseInvite.maxUses} uses.`,
            )
          }
          // store new invites
          await listInvites(discordClient, robot)

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
            const roleName = `Defense ${auditChannelType}: ${
              clientName || channel.name
            }`

            const role = await channel.guild.roles.create({
              name: roleName,
              reason: `Role for ${channel.name} channel`,
            })

            await channel.permissionOverwrites.create(role, {
              ViewChannel: true,
            })

            if (auditChannelType === "Internal") {
              const externalAuditChannel = channel.guild.channels.cache.find(
                (c) =>
                  c.name === `🔒ext-${clientName.toLowerCase()}-audit` &&
                  c.parent &&
                  c.parent.name === "defense",
              ) as TextChannel

              if (externalAuditChannel) {
                await externalAuditChannel.permissionOverwrites.create(
                  role.id,
                  {
                    ViewChannel: true,
                  },
                )
                channel.send(
                  `**${role.name}** role granted ViewChannel access to the external audit channel **${externalAuditChannel.name}**`,
                )
                robot.logger.info(
                  `ViewChannel access granted to ${role.name} for external audit channel ${externalAuditChannel.name}`,
                )
              } else {
                channel.send("No matching external audit channel found.")
                robot.logger.info(
                  "No matching external audit channel found for " +
                    `ext-${clientName.toLowerCase()}-audit`,
                )
              }
            }

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
            `An error occurred setting up the defense ${auditChannelType.toLowerCase()} audit channel: ${error}`,
          )
        }
      }
    })

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
      const newInvites = new Collection<string, { uses: number }>(
        fetchedInvites.map((invite) => [
          invite.code,
          { uses: invite.uses ?? 0 },
        ]),
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
        return (fetchedInvite.uses ?? 0) > (oldInvite ? oldInvite.uses : 0)
      })

      robot.logger.info(`Used Invite: ${usedInvite ? usedInvite.code : "None"}`)

      if (usedInvite && usedInvite.channelId) {
        const channel = member.guild.channels.cache.get(
          usedInvite.channelId,
        ) as TextChannel
        if (channel) {
          const channelTypeMatch = channel.name.match(/(ext|int)-(.*)-audit/)
          const auditChannelType = channelTypeMatch
            ? channelTypeMatch[1] === "ext"
              ? "External"
              : "Internal"
            : null
          const clientName = channelTypeMatch
            ? channelTypeMatch[2].replace(/-/g, " ")
            : ""
          robot.logger.info(`Channel Name: ${channel.name}`)
          robot.logger.info(`Audit Channel Type: ${auditChannelType}`)

          if (auditChannelType) {
            const fixedClientName = clientName
              .split(" ")
              .map(
                (word) =>
                  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
              )
              .join(" ")
            const roleName = `Defense ${auditChannelType}: ${fixedClientName}`
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
