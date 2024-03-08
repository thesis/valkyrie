import { Robot } from "hubot"
import { Client, TextChannel, VoiceChannel, StageChannel } from "discord.js"

async function manageInvite(
  discordClient: Client,
  guildId: string,
  channelId: string,
  action: "create" | "delete",
  maxAge: number | string = 86400,
  maxUses: number | string = 0,
): Promise<string | null> {
  if (!discordClient) {
    throw new Error("Discord client is not initialized.")
  }

  const guild = await discordClient.guilds.fetch(guildId)
  if (!guild) throw new Error("Guild not found.")

  const channel = await guild.channels.cache.get(channelId)
  if (!channel) throw new Error("Channel not found.")

  const numericMaxAge =
    typeof maxAge === "string" ? parseInt(maxAge, 10) : maxAge
  const numericMaxUses =
    typeof maxUses === "string" ? parseInt(maxUses, 10) : maxUses

  if (Number.isNaN(numericMaxAge) || Number.isNaN(numericMaxUses)) {
    throw new Error("maxAge and maxUses must be valid numbers.")
  }

  if (action === "create") {
    if (
      channel instanceof TextChannel ||
      channel instanceof VoiceChannel ||
      channel instanceof StageChannel
    ) {
      const invite = await channel.createInvite({
        maxAge: numericMaxAge,
        maxUses: numericMaxUses,
        unique: true,
      })
      return invite.url
    }
  }
  if (action === "delete") {
    throw new Error(
      "Delete action is not supported directly through this function.",
    )
  }
  return null
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    discordClient.on("messageCreate", async (message) => {
      if (message.author.bot || !message.content.startsWith("!create-invite"))
        return

      if (!message.guild) return

      const channelId = message.channel.id
      const guildId = message.guild.id
      const maxAge = 86400 // 1 day
      const maxUses = 10

      try {
        const inviteUrl = await manageInvite(
          discordClient,
          guildId,
          channelId,
          "create",
          maxAge,
          maxUses,
        )

        if (inviteUrl) {
          robot.logger.info("New invite URL:", inviteUrl)
          message.channel.send(
            `Here is your invite link: ${inviteUrl}\n` +
              `This invite expires in ${
                maxAge / 3600
              } hours and has a maximum of ${maxUses} uses.`,
          )
        } else {
          message.channel.send("Unable to create an invite link.")
        }
      } catch (error) {
        message.channel.send(`An error occurred: ${error}`)
      }
    })

    // Generates an invite if the channel name matches ext-*-audit format
    discordClient.on("channelCreate", async (channel) => {
      if (channel.parent && channel.parent.name === "defense") {
        const regex = /^ext-.*-audit$/
        if (regex.test(channel.name)) {
          try {
            const guildId = channel.guild.id
            const channelId = channel.id
            const maxAge = 86400 // 1 day
            const maxUses = 5
            const inviteUrl = await manageInvite(
              discordClient,
              guildId,
              channelId,
              "create",
              maxAge,
              maxUses,
            )
            if (inviteUrl) {
              robot.logger.info(
                `New invite created for defense audit channel: ${channel.name}, URL: ${inviteUrl}`,
              )
              if (channel instanceof TextChannel) {
                channel.send(
                  `Here is your invite link: ${inviteUrl}\n` +
                    `This invite expires in ${
                      maxAge / 3600
                    } hours and has a maximum of ${maxUses} uses.`,
                )
              }
            }
          } catch (error) {
            robot.logger.error(
              `An error occurred setting up the defense audit channel: ${error}`,
            )
          }
        }
      }
    })
  }
}
