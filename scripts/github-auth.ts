// Description:
//   Allows a chat user to register a GitHub API token with the bot via OAuth.
//
// Dependencies:
//   passport-init
//
// Configuration:
//   HUBOT_HOST - Hostname for the Hubot, sans trailing /, e.g. https://example.herokuapp.com
//   GITHUB_CLIENT_ID - client id for the GitHub OAuth Application that will be used
//   GITHUB_CLIENT_SECRET - client secret for the GitHub OAuth Application that will be used
//
// Commands:
//   hubot github auth - returns a URL where you can identify your GitHub self to the hubot. Upon identification, if a pending addition request exists from a call to `github add user`, it will be executed.

import cookieParser from "cookie-parser"
import { Robot } from "hubot"
import { VerifyCallback } from "jsonwebtoken"
import passport from "passport"
import { Strategy as GitHubStrategy } from "passport-github2"
import UUIDV4 from "uuid/v4.js"
import {
	issueReporterForRobot,
	withConfigOrReportIssues,
} from "../lib/config.ts"
import { HOST, MILLISECOND, MINUTE } from "../lib/globals.ts"

const PENDING_GITHUB_TOKENS_KEY = "pendingGitHubTokens"
const GITHUB_TOKENS_KEY = "gitHubTokens"

export default function setupGitHubAuth(robot: Robot) {
	withConfigOrReportIssues(
		issueReporterForRobot(robot),
		"GITHUB_CLIENT_ID",
		"GITHUB_CLIENT_SECRET",
	)((githubClientId, githubClientSecret) => {
		robot.router.use(cookieParser())
		passport.use(
			new GitHubStrategy(
				{
					clientID: githubClientId,
					clientSecret: githubClientSecret,
					callbackURL: `${HOST}/github/auth`,
					userAgent: "https://thesis.co",
				},
				(
					accessToken: string,
					_: string,
					profile: unknown,
					done: VerifyCallback,
				) => {
					// @ts-expect-error no strict null checks = not typed for null lel
					done(null, { token: accessToken, profile })
				},
			),
		)

		function cleanPending() {
			const now = new Date().getTime()
			const pendingGitHubTokens: { [userID: string]: { date: number } } =
				robot.brain.get(PENDING_GITHUB_TOKENS_KEY) || {}

			// Skip for expediency.
			// eslint-disable-next-line no-restricted-syntax
			for (const [userID, pendingInfo] of Object.entries(pendingGitHubTokens)) {
				if (now - pendingInfo.date > 5 * MINUTE) {
					delete pendingGitHubTokens[userID]
				}
			}

			robot.brain.set(PENDING_GITHUB_TOKENS_KEY, pendingGitHubTokens)
		}

		setInterval(cleanPending, 30 * MILLISECOND)
		cleanPending()

		robot.respond(/github auth/, (res) => {
			const { user } = res.message
			const token = UUIDV4()

			const pendingGitHubTokens =
				robot.brain.get(PENDING_GITHUB_TOKENS_KEY) || {}
			pendingGitHubTokens[user.id] = {
				token,
				date: new Date().getTime(),
			}
			robot.brain.set(PENDING_GITHUB_TOKENS_KEY, pendingGitHubTokens)

			res.reply(
				`You can authorize access at ${HOST}/github/auth/${token} in the next 5 minutes.`,
			)
		})

		robot.router.get("/github/auth/:token", (req, res) => {
			const { token } = req.params
			const pendingGitHubTokens: { [userID: string]: { token: string } } =
				robot.brain.get(PENDING_GITHUB_TOKENS_KEY) || {}

			const found = Object.entries(pendingGitHubTokens).some(
				([, pendingInfo]) => {
					if (token === pendingInfo.token) {
						// Set GitHub auth token.
						res.cookie("gh-auth-token", token, {
							httpOnly: true,
							// secure: true, TODO turn this on...
							sameSite: "lax",
						})
						return true
					}
					return false
				},
			)

			if (found) {
				res
					.status(200)
					.send(
						`All set, please <a href="/github/auth/${token}/redirect">click here to authenticate.</a>`,
					)
			} else {
				res.status(404).send("Unknown token.")
			}
		})

		robot.router.get("/github/auth/:token/redirect", (req, res, next) => {
			const token = req.cookies["gh-auth-token"]
			if (token === req.params.token) {
				passport.authorize("github", { scope: ["admin:org"] })(req, res, next)
			} else {
				res.status(404).send("Unknown token.")
			}
		})

		robot.router.get(
			"/github/auth",
			passport.authenticate("github", {
				failureRedirect: "/github/auth/fail",
				session: false,
				assignProperty: "gitHubUser",
			}),
			(req, res) => {
				const token = req.cookies["gh-auth-token"]
				const gitHubToken = (
					req as unknown as { gitHubUser: { token: string } }
				).gitHubUser.token
				const pendingGitHubTokens: { [userID: string]: { token: string } } =
					robot.brain.get(PENDING_GITHUB_TOKENS_KEY) || {}
				const gitHubTokens = robot.brain.get(GITHUB_TOKENS_KEY) || {}

				const found = Object.entries(pendingGitHubTokens).some(
					([userId, pendingInfo]) => {
						if (token === pendingInfo.token) {
							delete pendingGitHubTokens[userId]
							gitHubTokens[userId] = gitHubToken

							robot.brain.set(PENDING_GITHUB_TOKENS_KEY, pendingGitHubTokens)
							robot.brain.set(GITHUB_TOKENS_KEY, gitHubTokens)

							return true
						}
						return false
					},
				)

				res.cookie("gh-auth-token", "")
				if (found) {
					res
						.status(200)
						.send("<!doctype html><html><body>Got it!</body></html>")
				} else {
					res.status(404).send("Unrecognized token from GitHub.")
				}
			},
		)
	})
}
