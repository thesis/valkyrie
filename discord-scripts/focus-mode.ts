import {
  ChannelType,
  Client,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  TextChannel,
} from "discord.js"
import { Robot } from "hubot"

export default async function setupFocusChannels(
  discordClient: Client,
  robot: Robot,
) {
  discordClient.on("ready", async () => {
    discordClient.guilds.cache.forEach(async (guild) => {
      const focusChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name.startsWith("focus"),
      ) as TextChannel | undefined

      if (!focusChannel) {
        robot.logger.info(`Focus channel not found in guild: ${guild.name}`)
        return
      }

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("enable-focus")
          .setLabel("Enable Focus")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("disable-focus")
          .setLabel("Disable Focus")
          .setStyle(ButtonStyle.Danger),
      )

      await focusChannel.send({
        content:
          "**Focus Mode**\nSelect an option to enable or disable focus mode.",
        components: [actionRow],
      })

      robot.logger.info(
        `Focus mode options sent to the focus channel in guild: ${guild.name}`,
      )
    })
  })

  discordClient.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId === "enable-focus") {
        await interaction.reply({
          content: "Focus mode enabled.",
          ephemeral: true,
        })
      } else if (interaction.customId === "disable-focus") {
        await interaction.reply({
          content: "Focus mode disabled.",
          ephemeral: true,
        })
      }
    }
  })
}
