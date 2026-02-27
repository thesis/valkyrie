import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	ComponentType,
	Message,
	ThreadChannel,
} from "discord.js"
import { Robot } from "hubot"

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const GITHUB_ISSUE_TOKEN = process.env.GITHUB_ISSUE_TOKEN
const MEZO_ISSUE_REPORTS_CHANNEL = "mezo-issue-reports"
const GITHUB_REPO_OWNER = "Mezo-org"
const GITHUB_REPO_NAME = "web"
const COMMAND_NAME = "investigate"
const MAX_DISCORD_MESSAGE_LENGTH = 2000

async function summarizeForGitHubIssue(
	robot: Robot,
	threadTitle: string,
	messagesText: string,
): Promise<{ title: string; body: string }> {
	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": ANTHROPIC_API_KEY!,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: "claude-sonnet-4-20250514",
			max_tokens: 4096,
			messages: [
				{
					role: "user",
					content: `You are converting a Discord issue-report thread into a GitHub issue for an engineering team. The thread comes from a #mezo-issue-reports channel.

Produce a JSON object with two fields:
- "title": A concise GitHub issue title (under 80 characters) that captures the core problem.
- "body": A well-structured GitHub issue body in markdown with these sections:

## Issue Report (from Discord)
Summarize what was reported, including any reproduction steps or context.

## Observed Behavior
What the reporter(s) described happening.

## Expected Behavior
What should happen instead (infer from context if not stated).

## Additional Context
Any relevant details from the thread (screenshots mentioned, links, environment info, etc.).

Here is the Discord thread to convert:

**Thread title:** ${threadTitle}

**Messages:**
${messagesText}

Respond ONLY with the JSON object, no other text.`,
				},
			],
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(
			`Claude API request failed: ${response.status} ${response.statusText} - ${errorText}`,
		)
	}

	const data = await response.json()
	const textResponse = data?.content?.[0]?.text

	if (!textResponse) {
		throw new Error("No response from Claude API")
	}

	const jsonMatch = textResponse.match(/\{[\s\S]*\}/)
	if (!jsonMatch) {
		throw new Error("Could not parse JSON from Claude response")
	}

	return JSON.parse(jsonMatch[0])
}

async function createGitHubIssue(
	title: string,
	body: string,
	threadUrl: string,
): Promise<{ html_url: string; number: number }> {
	const issueBody = `${body}

---

> **Source:** [Discord thread in #mezo-issue-reports](${threadUrl})

@claude Analyze this issue report against the codebase. Summarize the likely root cause, identify the relevant files and code paths, and propose a fix with code changes. If you can confidently produce a fix, open a pull request.`

	const response = await fetch(
		`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${GITHUB_ISSUE_TOKEN}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({
				title,
				body: issueBody,
				labels: ["discord-report", "investigate"],
			}),
		},
	)

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(
			`GitHub API request failed: ${response.status} ${response.statusText} - ${errorText}`,
		)
	}

	return response.json()
}

function buildThreadUrl(thread: ThreadChannel): string {
	return `https://discord.com/channels/${thread.guildId}/${thread.id}`
}

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
				robot,
				thread.name,
				formattedMessages,
			)

			const threadUrl = buildThreadUrl(thread)
			const issue = await createGitHubIssue(title, body, threadUrl)

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
