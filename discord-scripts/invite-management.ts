import { Robot } from "hubot"
import {
  Client,
  TextChannel,
  VoiceChannel,
  StageChannel,
  ApplicationCommandOptionType,
} from "discord.js"

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
          options: [
            {
              name: "max-age",
              description: "The maximum age of the invite in hours",
              type: ApplicationCommandOptionType.Number,
              required: false,
            },
            {
              name: "max-uses",
              description: "The maximum uses of the invite",
              type: ApplicationCommandOptionType.Number,
              required: false,
            },
          ],
        },
      ])
      robot.logger.info("create invite command set")
    }
    // create an invite based of the command and channel where the command has been run
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

      const maxAge =
        ((interaction.options.get("max-age", false)?.value as number) ?? 24) *
        3600
      const maxUses =
        (interaction.options.get("max-uses", false)?.value as number) ?? 10

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
              maxAge / 3600
            } hours and has a maximum of ${maxUses} uses.`,
          )
        } else {
          await interaction.reply(
            "Cannot create an invite for this type of channel.",
          )
        }
      } catch (error) {
        await interaction.reply("An error occurred while creating an invite.")
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
