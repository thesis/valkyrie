import {
  Client,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
} from "discord.js"

export default async function setupRoleChannels(discordClient: Client) {
  const { application } = discordClient

  if (application) {
    discordClient.on("messageCreate", async (message) => {
      if (message.content.startsWith("!select-role")) {
        const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("choose-project")
            .setLabel("Choose Project")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("choose-department")
            .setLabel("Choose Department")
            .setStyle(ButtonStyle.Primary),
        )

        try {
          await message.reply({
            content: "How can Valkyrie Help you?:",
            components: [actionRow],
          })
        } catch (error) {
          console.error("Could not send reply in channel.", error)
          await message.reply("Error sending role selection options.")
        }
      }
    })
    discordClient.on("interactionCreate", async (interaction) => {
      if (!interaction.isButton()) return

      if (interaction.customId === "choose-project") {
        const projectRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("mezo")
            .setLabel("Mezo")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("Taho")
            .setLabel("taho")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("Thesis Defense")
            .setLabel("defense")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("Acre")
            .setLabel("acre")
            .setStyle(ButtonStyle.Secondary),
        )

        await interaction.reply({
          content: "Select a project:",
          components: [projectRow],
          ephemeral: true,
        })
      } else if (interaction.customId === "chhose-department") {
        await interaction.reply({
          content: "department selection is not implemented yet.",
          ephemeral: true,
        })
      }
    })
  }
}
