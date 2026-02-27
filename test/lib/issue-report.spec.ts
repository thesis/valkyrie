import { beforeEach, describe, expect, jest, test } from "@jest/globals"
import {
	buildThreadUrl,
	createGitHubIssue,
	summarizeForGitHubIssue,
} from "../../lib/issue-report.ts"

const mockFetch = jest.fn<typeof global.fetch>()
global.fetch = mockFetch

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as Response
}

beforeEach(() => {
	mockFetch.mockReset()
})

describe("summarizeForGitHubIssue", () => {
	const validClaudeResponse = {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					title: "Login button unresponsive on mobile",
					body: "## Issue Report\nUsers report the login button does not work.",
				}),
			},
		],
	}

	test("returns parsed title and body from Claude response", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(validClaudeResponse))

		const result = await summarizeForGitHubIssue(
			"test-key",
			"Login broken",
			"alice: login doesn't work on my phone",
		)

		expect(result.title).toBe("Login button unresponsive on mobile")
		expect(result.body).toContain("Issue Report")
	})

	test("sends correct headers and model to Claude API", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(validClaudeResponse))

		await summarizeForGitHubIssue(
			"my-api-key",
			"Thread",
			"message content",
		)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [url, options] = mockFetch.mock.calls[0]
		expect(url).toBe("https://api.anthropic.com/v1/messages")
		const headers = (options as RequestInit).headers as Record<string, string>
		expect(headers["x-api-key"]).toBe("my-api-key")
		const body = JSON.parse((options as RequestInit).body as string)
		expect(body.model).toBe("claude-haiku-4-5")
	})

	test("throws on Claude API HTTP error", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: "rate limited" }, 429),
		)

		await expect(
			summarizeForGitHubIssue("test-key", "Thread", "messages"),
		).rejects.toThrow("Claude API request failed: 429")
	})

	test("throws on unexpected Claude response shape", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ content: [] }),
		)

		await expect(
			summarizeForGitHubIssue("test-key", "Thread", "messages"),
		).rejects.toThrow()
	})

	test("throws when Claude returns no JSON in text", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				content: [{ type: "text", text: "I cannot produce that." }],
			}),
		)

		await expect(
			summarizeForGitHubIssue("test-key", "Thread", "messages"),
		).rejects.toThrow("Could not parse JSON from Claude response")
	})

	test("throws when Claude JSON is missing required fields", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				content: [{ type: "text", text: JSON.stringify({ title: "" }) }],
			}),
		)

		await expect(
			summarizeForGitHubIssue("test-key", "Thread", "messages"),
		).rejects.toThrow()
	})

	test("extracts JSON even when surrounded by extra text", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				content: [
					{
						type: "text",
						text: `Here is the result:\n${JSON.stringify({
							title: "Bug in checkout",
							body: "## Issue Report\nCheckout fails.",
						})}\nDone.`,
					},
				],
			}),
		)

		const result = await summarizeForGitHubIssue(
			"test-key",
			"Checkout",
			"bob: checkout is broken",
		)
		expect(result.title).toBe("Bug in checkout")
	})
})

describe("createGitHubIssue", () => {
	const validGitHubResponse = {
		html_url: "https://github.com/Mezo-org/web/issues/42",
		number: 42,
	}

	test("returns parsed GitHub issue response", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(validGitHubResponse))

		const result = await createGitHubIssue(
			"gh-token",
			"Bug title",
			"Bug body",
			"https://discord.com/channels/123/456",
		)

		expect(result.html_url).toBe(
			"https://github.com/Mezo-org/web/issues/42",
		)
		expect(result.number).toBe(42)
	})

	test("sends correct authorization header", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(validGitHubResponse))

		await createGitHubIssue(
			"my-gh-token",
			"Title",
			"Body",
			"https://discord.com/channels/123/456",
		)

		const [, options] = mockFetch.mock.calls[0]
		const headers = (options as RequestInit).headers as Record<string, string>
		expect(headers.Authorization).toBe("Bearer my-gh-token")
	})

	test("includes @claude trigger in issue body", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(validGitHubResponse))

		await createGitHubIssue(
			"gh-token",
			"Title",
			"Body content",
			"https://discord.com/channels/123/456",
		)

		const [, options] = mockFetch.mock.calls[0]
		const body = JSON.parse((options as RequestInit).body as string)
		expect(body.body).toContain("@claude")
		expect(body.body).toContain("Body content")
		expect(body.body).toContain("discord.com/channels/123/456")
	})

	test("throws on GitHub API HTTP error", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ message: "Not Found" }, 404),
		)

		await expect(
			createGitHubIssue(
				"gh-token",
				"Title",
				"Body",
				"https://discord.com/channels/123/456",
			),
		).rejects.toThrow("GitHub API request failed: 404")
	})

	test("throws on unexpected GitHub response shape", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ id: 42, url: "not-a-valid-url" }),
		)

		await expect(
			createGitHubIssue(
				"gh-token",
				"Title",
				"Body",
				"https://discord.com/channels/123/456",
			),
		).rejects.toThrow()
	})
})

describe("buildThreadUrl", () => {
	test("constructs a Discord thread URL", () => {
		expect(buildThreadUrl("guild-123", "thread-456")).toBe(
			"https://discord.com/channels/guild-123/thread-456",
		)
	})
})
