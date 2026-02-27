import { z } from "zod/v4"

const GITHUB_REPO_OWNER = "Mezo-org"
const GITHUB_REPO_NAME = "web"

const claudeMessageResponseSchema = z.object({
	content: z
		.array(
			z.object({
				type: z.literal("text"),
				text: z.string(),
			}),
		)
		.min(1),
})

const issueSummarySchema = z.object({
	title: z.string().min(1),
	body: z.string().min(1),
})

const gitHubIssueResponseSchema = z.object({
	html_url: z.string().url(),
	number: z.number().int(),
})

type IssueSummary = z.infer<typeof issueSummarySchema>
type GitHubIssueResponse = z.infer<typeof gitHubIssueResponseSchema>

export async function summarizeForGitHubIssue(
	anthropicApiKey: string,
	threadTitle: string,
	messagesText: string,
): Promise<IssueSummary> {
	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": anthropicApiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: "claude-haiku-4-5",
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

	const data = claudeMessageResponseSchema.parse(await response.json())
	const textResponse = data.content[0].text

	const jsonMatch = textResponse.match(/\{[\s\S]*\}/)
	if (!jsonMatch) {
		throw new Error("Could not parse JSON from Claude response")
	}

	return issueSummarySchema.parse(JSON.parse(jsonMatch[0]))
}

export async function createGitHubIssue(
	githubToken: string,
	title: string,
	body: string,
	threadUrl: string,
): Promise<GitHubIssueResponse> {
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
				Authorization: `Bearer ${githubToken}`,
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

	return gitHubIssueResponseSchema.parse(await response.json())
}

export function buildThreadUrl(guildId: string, threadId: string): string {
	return `https://discord.com/channels/${guildId}/${threadId}`
}
