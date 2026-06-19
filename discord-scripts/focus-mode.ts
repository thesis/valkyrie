import {
  ChannelType,
  Client,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  TextChannel,
  Message,
} from "discord.js"
import { Robot } from "hubot"
import manageRole from "./role-management/index.ts"

const focusModeState: Map<string, boolean> = new Map()

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

export default async function setupFocusChannels(
  discordClient: Client,
  robot: Robot,
) {
  const { application } = discordClient

  if (application) {
    robot.logger.info("Discord client ready, setting up focus channels.")

    discordClient.guilds.cache.forEach(async (guild) => {
      const focusChannels = guild.channels.cache.filter(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name.startsWith("focus"),
      )

      focusChannels.forEach(async (channel) => {
        const focusChannel = channel as TextChannel
        const guildId = guild.id

        if (!focusModeState.has(guildId)) {
          focusModeState.set(guildId, false)
          robot.logger.info(
            `Initializing focus mode state for guild: ${guild.name}`,
          )
        }

        robot.logger.info(
          `Setting up focus mode for channel: ${channel.name} in guild: ${guild.name}`,
        )
        await sendFocusModeMessage(focusChannel, guildId, robot)
      })
    })
  }

  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return

    const guildId = interaction.guildId
    if (!guildId || !interaction.member) return

    let isEnabled = focusModeState.get(guildId) || false

    if (interaction.customId === "enable-focus") {
      isEnabled = true
      await interaction.reply({
        content: "Focus mode enabled.",
        ephemeral: true,
      })
      await manageRole(
        discordClient,
        guildId,
        interaction.member.user.id,
        "1205116222161813545",
        "add",
      )
    } else if (interaction.customId === "disable-focus") {
      isEnabled = false
      await interaction.reply({
        content: "Focus mode disabled.",
        ephemeral: true,
      })
      await manageRole(
        discordClient,
        guildId,
        interaction.member.user.id,
        "1205116222161813545",
        "remove",
      )
    }

    focusModeState.set(guildId, isEnabled)
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
