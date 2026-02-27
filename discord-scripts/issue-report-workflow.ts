import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	ComponentType,
	Message,
} from "discord.js"
import { Robot } from "hubot"
import {
	buildThreadUrl,
	createGitHubIssue,
	summarizeForGitHubIssue,
} from "../lib/issue-report.ts"

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const GITHUB_ISSUE_TOKEN = process.env.GITHUB_ISSUE_TOKEN
const MEZO_ISSUE_REPORTS_CHANNEL = "mezo-issue-reports"
const GITHUB_REPO_OWNER = "Mezo-org"
const GITHUB_REPO_NAME = "web"
const COMMAND_NAME = "investigate"
const MAX_DISCORD_MESSAGE_LENGTH = 2000

export default async function issueReportWorkflow(
	discordClient: Client,
	robot: Robot,
) {
	if (!ANTHROPIC_API_KEY) {
		robot.logger.error(
			"ANTHROPIC_API_KEY is not set. Skipping issue report workflow setup.",
		)
		return
	}

	if (!GITHUB_ISSUE_TOKEN) {
		robot.logger.error(
			"GITHUB_ISSUE_TOKEN is not set. Skipping issue report workflow setup.",
		)
		return
	}

	const { application } = discordClient
	if (application === null) {
		robot.logger.error(
			"Failed to resolve Discord application, dropping issue report workflow.",
		)
		return
	}

	const existingCommand = (await application.commands.fetch()).find(
		(command) => command.name === COMMAND_NAME,
	)

	if (existingCommand === undefined) {
		robot.logger.info("No investigate command yet, creating it!")
		await application.commands.create({
			name: COMMAND_NAME,
			description:
				"Create a GitHub issue from this thread and trigger Claude Code to investigate",
		})
		robot.logger.info("Created investigate command.")
	}

	discordClient.on("interactionCreate", async (interaction) => {
		if (
			!interaction.isChatInputCommand() ||
			interaction.commandName !== COMMAND_NAME ||
			interaction.channel === null ||
			interaction.channel.isDMBased()
		) {
			return
		}

		if (!interaction.channel.isThread()) {
			await interaction.reply({
				content:
					"The `/investigate` command can only be used inside a thread.",
				ephemeral: true,
			})
			return
		}

		const thread = interaction.channel
		const parentChannel = thread.parent

		if (!parentChannel || parentChannel.name !== MEZO_ISSUE_REPORTS_CHANNEL) {
			await interaction.reply({
				content: `The \`/investigate\` command can only be used in threads within #${MEZO_ISSUE_REPORTS_CHANNEL}.`,
				ephemeral: true,
			})
			return
		}

		const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("confirm_investigate")
				.setLabel("Create Issue & Investigate")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId("cancel_investigate")
				.setLabel("Cancel")
				.setStyle(ButtonStyle.Secondary),
		)

		await interaction.reply({
			content: `This will:\n1. Summarize this thread into a GitHub issue on **${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}**\n2. Trigger Claude Code to analyze the codebase and propose a fix\n\nProceed?`,
			components: [confirmRow],
			ephemeral: true,
		})

		const confirmation = await interaction.channel
			?.awaitMessageComponent({
				componentType: ComponentType.Button,
				time: 30_000,
				filter: (buttonInteraction) =>
					buttonInteraction.user.id === interaction.user.id,
			})
			.catch(() => null)

		if (!confirmation || confirmation.customId === "cancel_investigate") {
			await interaction.followUp({
				content: "Investigation cancelled.",
				ephemeral: true,
			})
			return
		}

		await confirmation.update({
			content: "Collecting thread messages and creating GitHub issue...",
			components: [],
		})

		try {
			const messages = await thread.messages.fetch({ limit: 100 })
			if (!messages.size) {
				await interaction.followUp({
					content: "No messages found in this thread.",
					ephemeral: true,
				})
				return
			}

			const formattedMessages = messages
				.map(
					(m: Message) =>
						`${m.member?.displayName ?? m.author.displayName ?? m.author.username}: ${m.content}`,
				)
				.reverse()
				.join("\n")

			const { title, body } = await summarizeForGitHubIssue(
				ANTHROPIC_API_KEY,
				thread.name,
				formattedMessages,
			)

			const threadUrl = buildThreadUrl(thread.guildId, thread.id)
			const issue = await createGitHubIssue(
				GITHUB_ISSUE_TOKEN,
				title,
				body,
				threadUrl,
			)

			const resultMessage = `GitHub issue created and Claude Code investigation triggered!\n${issue.html_url}`

			if (resultMessage.length > MAX_DISCORD_MESSAGE_LENGTH) {
				await thread.send(
					resultMessage.substring(0, MAX_DISCORD_MESSAGE_LENGTH),
				)
			} else {
				await thread.send(resultMessage)
			}

			await interaction.followUp({
				content: "Issue created and investigation started!",
				ephemeral: true,
			})
		} catch (error) {
			robot.logger.error("Failed to create investigation issue:", error)
			await interaction.followUp({
				content:
					"Failed to create the GitHub issue. Check the bot logs for details.",
				ephemeral: true,
			})
		}
	})

	robot.logger.info("Issue report workflow script loaded.")
}
