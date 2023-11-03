import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"
import moment from "moment"

const GUILD: string = process.env.GUILD ?? ""

function weekdaysBefore(theMoment: any, days: any) {
  let newMoment = theMoment.clone()
  while(days > 0) {
    if (newMoment.isoWeekday() < 6) {
      days -= 1
    }
    newMoment = newMoment.subtract(1, 'days')
  }
  return newMoment
}

export default async function webhookDiscord(
  discordClient: Client,
  robot: Robot,
) {
	robot.hear(/blow everything up/, async (msg) => {
	const guilds = discordClient.guilds.cache
	const guild = discordClient.guilds.cache.first()
	if (guild === undefined) {
		msg.reply("Whoops, no guilds.")
		return
	} else {
		msg.reply("Running it with", guild.name)
	}
	const channels = await guild.channels.fetch()
	const archiveThreshold = weekdaysBefore(moment(), 4)
	channels
		.filter((channel): channel is TextChannel => channel !== null && channel.isTextBased() && channel.viewable)
		.forEach(async channel => {
			const threads = await channel.threads.fetch()
			threads.threads.forEach(async thread => {
				const messages = await thread.messages.fetch({limit: 1})

				const firstMessage = messages.first()
				const lastActivity = Math.max(
					firstMessage?.createdTimestamp ?? 0,
					thread.archiveTimestamp ?? 0
				)
				if (moment(lastActivity).isAfter(archiveThreshold)) {
					return
				}

				// await thread.setArchived(true)
				msg.reply("We would archive", thread.name)
			})
		})
	})
}
