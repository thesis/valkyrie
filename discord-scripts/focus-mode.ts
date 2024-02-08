import {
  ChannelType,
  Client,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  TextChannel,
  Interaction,
  Message,
} from "discord.js"
import { Robot } from "hubot"

const focusModeState: Map<string, boolean> = new Map()

export default async function setupFocusChannels(
  discordClient: Client,
  robot: Robot,
) {
  discordClient.on("ready", async () => {
    robot.logger.info("Focus mode script loaded!")
    discordClient.guilds.cache.forEach(async (guild) => {
      // initialize for each guild
      focusModeState.set(guild.id, false)

      const focusChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name.startsWith("focus"),
      ) as TextChannel | undefined

      if (!focusChannel) {
        robot.logger.info(`Focus channel not found in guild: ${guild.name}`)
        return
      }

      sendFocusModeMessage(focusChannel, guild.id, robot)
    })
  })

  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return

    const guildId = interaction.guildId
    if (!guildId) return

    let isEnabled = focusModeState.get(guildId) || false

    if (interaction.customId === "enable-focus") {
      isEnabled = true
      await interaction.reply({
        content: "Focus mode enabled.",
        ephemeral: true,
      })
    } else if (interaction.customId === "disable-focus") {
      isEnabled = false
      await interaction.reply({
        content: "Focus mode disabled.",
        ephemeral: true,
      })
    }

    focusModeState.set(guildId, isEnabled)

    // update original message if possible, or send a new one
    if (interaction.message instanceof Message) {
      sendFocusModeMessage(
        interaction.channel as TextChannel,
        guildId,
        robot,
        interaction.message,
      )
    }
  })
}

async function sendFocusModeMessage(
  focusChannel: TextChannel,
  guildId: string,
  robot: Robot,
  originalMessage?: Message,
) {
  const isEnabled = focusModeState.get(guildId) || false

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("enable-focus")
      .setLabel("Enable Focus")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isEnabled),
    new ButtonBuilder()
      .setCustomId("disable-focus")
      .setLabel("Disable Focus")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isEnabled),
  )

  const messageContent = {
    content:
      "**Focus Mode**\nSelect an option to enable or disable focus mode.",
    components: [actionRow],
  }

  if (originalMessage) {
    await originalMessage.edit(messageContent)
  } else {
    await focusChannel.send(messageContent)
  }

  robot.logger.info(
    `Focus mode options updated in the focus channel of guild: ${guildId}`,
  )
}
