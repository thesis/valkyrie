import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	Events,
	Interaction,
	Message,
	TextChannel,
	ThreadChannel,
	VoiceChannel,
} from "discord.js"
import { Robot } from "hubot"

// Set to #alarm-trigger channel
const CHANNEL_ID = "1377183184902688862"
const { CRITICAL_INCIDENT_ROUTING_KEY, HIGH_INCIDENT_ROUTING_KEY } = process.env

export default async function incidentReport(
	discordClient: Client,
	robot: Robot,
) {
	if (!CRITICAL_INCIDENT_ROUTING_KEY) {
		robot.logger.error(
			"CRITICAL_INCIDENT_ROUTING_KEY is not set. Skipping incident report setup.",
		)
		return
	}
	if (!HIGH_INCIDENT_ROUTING_KEY) {
		robot.logger.error(
			"HIGH_INCIDENT_ROUTING_KEY is not set. Skipping incident report setup.",
		)
		return
	}
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
				.setCustomId("incident_critical")
				.setLabel("🚨 Critical: Security incident or chain halt")
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId("incident_high")
				.setLabel("🛎 High: Other high severity incident")
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId("incident_no")
				.setLabel("Don't Trigger")
				.setStyle(ButtonStyle.Secondary),
		)

		try {
			await message.reply({
				content: `**Before triggering an alert, ask yourself:**  
- Is this incident truly a Critical or High severity issue?  
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

			if (interaction.customId === "incident_critical") {
				try {
					await fetch("https://events.pagerduty.com/v2/enqueue", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							payload: {
								summary: "Mezo Security alert triggered from Discord",
								severity: "critical",
								source: "Mezo",
							},
							routing_key: CRITICAL_INCIDENT_ROUTING_KEY,
							event_action: "trigger",
						}),
					})

					await interaction.reply({
						content: "🚨 Critical severity alert has been triggered. Escalating to the Security Response group.",
					})
				} catch (error) {
					robot.logger.error("❌ Failed to trigger alert:", error)
					await interaction.reply({
						content: "⚠️ Failed to trigger alert.",
					})
				}
			} else if (interaction.customId === "incident_high") {
				try {
					await fetch("https://events.pagerduty.com/v2/enqueue", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							payload: {
								summary: "Mezo High severity alert triggered from Discord",
								severity: "critical", // PagerDuty does not support "high"
								source: "Mezo",
							},
							routing_key: HIGH_INCIDENT_ROUTING_KEY,
							event_action: "trigger",
						}),
					})

					await interaction.reply({
						content:
							"🛎 High severity alert has been triggered. Note these are handled during business hours.",
					})
				} catch (error) {
					robot.logger.error("❌ Failed to trigger alert:", error)
					await interaction.reply({
						content: "⚠️ Failed to trigger alert.",
					})
				}
			} else if (interaction.customId === "incident_no") {
				await interaction.reply({
					content: "No problem. Not marked as an incident.",
				})
			}

			await interaction.message.delete().catch((err) => {
				robot.logger.error("❌ Failed to delete message:", err)
			})
		},
	)
}
