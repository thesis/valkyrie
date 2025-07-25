import { Client } from "discord.js"
import fs from "fs"
import Hubot from "hubot"
import { DiscordBot } from "hubot-discord"
import path from "path"

// A script with a default export that takes a Discord client and returns
// nothing.
type DiscordScript = {
	default: (
		client: Client,
		robot: Hubot.Robot<DiscordBot>,
	) => void | Promise<void>
}

// We use unknown here because TS thinks Hubot.Robot<DiscordBot> is not
// assignable to Hubot.Robot<Adapter> due to DiscordBot being *more
// restrictive* than Adapter. Unclear why this is the case.
function isDiscordRobot(robot: unknown): robot is Hubot.Robot<DiscordBot> {
	return (robot as Hubot.Robot).adapter instanceof DiscordBot
}

function attachWithAdapter(robot: Hubot.Robot) {
	if (isDiscordRobot(robot)) {
		const { client } = robot.adapter

		if (client !== undefined) {
			fs.readdirSync("./discord-scripts")
				.sort()
				.filter((file) => [".ts", ".js"].includes(path.extname(file)))
				.forEach(async (file) => {
					try {
						const discordScript: DiscordScript = await import(
							path.join("..", "discord-scripts", file)
						)
						await discordScript.default(client, robot)
						robot.logger.info(`Loaded Discord script ${file}.`)
					} catch (error) {
						const stackString =
							// Errors may have a stack trace, or not---anyone's guess!
							error instanceof Error && error.stack ? `\n${error.stack}` : ""

						robot.logger.error(
							`Failed to load Discord script ${file}: ${JSON.stringify(
								error,
								null,
								2,
							)}${stackString}`,
						)
					}
				})
		}
	}
}

export default function attachDiscordScripts(robot: Hubot.Robot) {
	const { adapter } = robot

	if (adapter === undefined || adapter === null) {
		robot.events.once("adapter-initialized", attachWithAdapter)
	} else {
		attachWithAdapter(robot)
	}
}
