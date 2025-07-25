// Description:
//   Configures access control to restrict some commands to specific rooms.
//
//   This is mostly a direct lift from example code in the hubot docs:
//   https://hubot.github.com/docs/patterns/#restricting-access-to-commands
//   Modified to be room-based rather than user-based, and converted to js
//
// Configuration: All middleware executes in the order in which it loads.
//   If you have other middleware that must run in a specific order
//   relative to this one, please rename your files accordingly to force them
//   to load in the correct order!
//   https://hubot.github.com/docs/scripting/#execution-process-and-api
//
// Commands:
//   None
//
// Author:
//   kb0rg

import { Robot } from "hubot"
import { getRoomNameFromId } from "../lib/adapter-util.ts"

const ALLOWED_ROOMS = [
	"Bifrost",
	"Playground",
	"Playground, Too",
	"Playground Private (for hubot dev)",
] // string that matches the room name
const ALLOWED_BOTS = ["valkyrie"]

const BOT_RESTICTED_COMMANDS = ["reload-scripts.reload"] // string that matches the listener ID
const ROOM_RESTRICTED_COMMANDS = ["pod-bay-doors", "users", "reconnect"] // string that matches the listener ID

export default function setUpAccessLimit(robot: Robot) {
	robot.listenerMiddleware((context, next, done) => {
		if (
			BOT_RESTICTED_COMMANDS.indexOf(
				(context.listener as { options: { id: string } }).options.id,
			) >= 0
		) {
			if (ALLOWED_BOTS.indexOf(robot.name) >= 0) {
				// Bot is allowed access to this command
				next(done)
			} else {
				// Restricted command, and bot isn't in allowlist
				context.response?.reply(
					"Sorry, only *some* bots are allowed to do that",
				)
				done()
			}
		} else if (
			ROOM_RESTRICTED_COMMANDS.indexOf(
				(context.listener as { options: { id: string } }).options.id,
			) >= 0
		) {
			if (
				context.response !== undefined &&
				context.response.message.room === undefined
			) {
				// Restricted command, and this is a DM
				context.response.reply(
					"I'm sorry, but that command doesn't work in DMs.",
				)
				done()
			} else if (
				context.response !== undefined &&
				ALLOWED_ROOMS.indexOf(
					getRoomNameFromId(robot.adapter, context.response.envelope.room) ??
						"",
				) >= 0
			) {
				// User is allowed access to this command
				next(done)
			} else if (robot.adapterName === "shell") {
				// we're in the shell adapter: allow the command for local testing
				next(done)
			} else {
				// Restricted command, and flow isn't in allowlist
				context.response?.reply(
					"I'm sorry, but that command doesn't work here.",
				)
				done()
			}
		} else {
			// Not a restricted command
			next(done)
		}
	})
}
