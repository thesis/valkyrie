import { Client } from "discord.js"
import fs from "fs"
import { Robot } from "hubot"
import path from "path"
import { fileURLToPath } from "url"
import { DiscordEventHandlers } from "../lib/discord/utils.ts"

export default function manageThreads(discordClient: Client, robot: Robot) {
	fs.readdirSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"./thread-management",
		),
	)
		.sort()
		.filter(
			(file) =>
				[".ts", ".js"].includes(path.extname(file)) && !file.startsWith("_"),
		)
		.forEach(async (file) => {
			try {
				const threadManagementScript: { default: DiscordEventHandlers } =
					await import(
						path.join("..", "discord-scripts", "thread-management", file)
					)

				Object.entries(threadManagementScript.default).forEach(
					([event, handler]) => {
						discordClient.on(event, (...args) => {
							const finalArgs = [...args, robot]
							// @ts-expect-error We are doing some shenanigans here that TS can't
							// handle to always pass a robot as the last parameter to the
							// handler.
							return handler(...finalArgs)
						})
					},
				)

				if ("setup" in threadManagementScript) {
					;(
						threadManagementScript.setup as (
							robot: Robot,
							client: Client,
						) => Promise<void>
					).call(undefined, robot, discordClient)
				}

				robot.logger.info(`Loaded Discord thread management script ${file}.`)
			} catch (error) {
				const stackString =
					// Errors may have a stack trace, or not---anyone's guess!
					error instanceof Error && error.stack ? `\n${error.stack}` : ""

				const errorJson = JSON.stringify(error, null, 2)

				const errorDescription =
					errorJson.trim().length > 0 ? errorJson : String(error)

				robot.logger.error(
					`Failed to load Discord script ${file}: ${errorDescription}${stackString}`,
				)
			}
		})
}
