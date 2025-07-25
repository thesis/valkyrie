import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"

export default async function manageChannelPermissions(
	discordClient: Client,
	robot: Robot,
) {
	const { application } = discordClient
	if (process.env.DEFENSE_CATEGORY_ID) {
		if (application) {
			discordClient.on("channelCreate", async (channel) => {
				if (
					channel.parent &&
					channel.parentId === process.env.DEFENSE_CATEGORY_ID
				) {
					const permissions = channel.parent.permissionOverwrites.cache
					await channel.permissionOverwrites.set(permissions)
					robot.logger.info("Channel permissions set to base category")
					if (channel instanceof TextChannel) {
						await channel.send(
							"This channel now has the same base permissions as the Defense category.",
						)
					}
				}
			})
		}
	}
}
