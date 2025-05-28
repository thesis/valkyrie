import {
  Client,
  Message,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  Interaction,
} from "discord.js"
import { Robot } from "hubot"
// Set to #alarm-trigger channel
const CHANNEL_ID = "1377183184902688862"
const { INCIDENT_ROUTING_KEY } = process.env

export default async function incidentReport(
  discordClient: Client,
  robot: Robot,
) {
  discordClient.on("messageCreate", async (message: Message) => {
    if (
      message.author.bot ||
      !(
        message.channel instanceof TextChannel ||
        message.channel instanceof ThreadChannel ||
        message.channel instanceof VoiceChannel
      )
    ) {
      return
    }

    if (message.channel.id !== CHANNEL_ID) return

    if (/code red/i.test(message.content)) {
      await message.reply({
        content:
          "🚨 Code Red detected! (https://youtu.be/WlPTmXi0pVk?feature=shared&t=61)",
        allowedMentions: { repliedUser: false },
      })
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("incident_yes")
        .setLabel("🚨 Wake Someone Up!")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("incident_no")
        .setLabel("Don't Trigger")
        .setStyle(ButtonStyle.Secondary),
    )

    try {
      await message.reply({
        content: `**Before triggering an alert, ask yourself:**  
- Is this incident truly a Critical or High severity issue?  
- Could this wait until regular business hours without major impact?  
- Can I resolve this with existing documentation or procedures?`,

        components: [row],
        allowedMentions: { repliedUser: false },
      })
    } catch (error) {
      robot.logger.error("❌ Failed to send incident report:", error)
    }
  })

  discordClient.on(
    Events.InteractionCreate,
    async (interaction: Interaction) => {
      if (!interaction.isButton()) return

      if (interaction.customId === "incident_yes") {
        try {
          await fetch("https://events.pagerduty.com/v2/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payload: {
                summary: "Mezo Critical alert triggered from Discord",
                severity: "critical",
                source: "Mezo",
              },
              routing_key: INCIDENT_ROUTING_KEY,
              event_action: "trigger",
            }),
          })

          await interaction.reply({
            content: "🚨 Alert has been triggered.",
            ephemeral: true,
          })
        } catch (error) {
          robot.logger.error("❌ Failed to trigger alert:", error)
          await interaction.reply({
            content: "⚠️ Failed to trigger alert.",
            ephemeral: true,
          })
        }
      } else if (interaction.customId === "incident_no") {
        await interaction.reply({
          content: "No problem. Not marked as an incident.",
          ephemeral: true,
        })
      }

      await interaction.message.delete().catch((err) => {
        robot.logger.error("❌ Failed to delete message:", err)
      })
    },
  )
}
