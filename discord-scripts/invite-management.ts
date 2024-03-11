import { Robot } from "hubot"
import { Client, TextChannel, VoiceChannel, StageChannel } from "discord.js"

async function createInvite(
  discordClient: Client,
  channelId: string,
  maxAge: number | string = 86400,
  maxUses: number | string = 0,
): Promise<string | null> {
  if (!discordClient) {
    throw new Error("Discord client is not initialized.")
  }

  let channelOrigin: TextChannel | VoiceChannel | StageChannel | null = null
  try {
    const fetchedChannel = await discordClient.channels.fetch(channelId)
    if (
      fetchedChannel instanceof TextChannel ||
      fetchedChannel instanceof VoiceChannel ||
      fetchedChannel instanceof StageChannel
    ) {
      channelOrigin = fetchedChannel
    }
  } catch (error) {
    throw new Error("Channel not found or access denied.")
  }

  if (!channelOrigin) {
    return null
  }

  const numericMaxAge = parseInt(maxAge.toString(), 10)
  const numericMaxUses = parseInt(maxUses.toString(), 10)

  if (Number.isNaN(numericMaxAge) || Number.isNaN(numericMaxUses)) {
    throw new Error("maxAge and maxUses must be valid numbers.")
  }

  const invite = await channelOrigin.createInvite({
    maxAge: numericMaxAge,
    maxUses: numericMaxUses,
    unique: true,
  })

  return invite.url
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    discordClient.on("messageCreate", async (message) => {
      if (message.author.bot || !message.content.startsWith("!create-invite"))
        return

      if (!message.guild) return

      const channelId = message.channel.id
      const maxAge = 86400 // 1 day
      const maxUses = 10

      try {
        const inviteUrl = await createInvite(
          discordClient,
          channelId,
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
            const channelId = channel.id
            const maxAge = 86400 // 1 day
            const maxUses = 5
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
