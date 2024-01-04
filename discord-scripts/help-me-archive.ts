import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"
import moment from "moment"

function weekdaysBefore(theMoment: ReturnType<typeof moment>, days: number) {
  let newMoment = theMoment.clone()
  let remainingDays = days
  while (remainingDays > 0) {
    if (newMoment.isoWeekday() < 6) {
      remainingDays -= 1
    }
    newMoment = newMoment.subtract(1, "days")
  }
  return newMoment
}

export default async function webhookDiscord(
  discordClient: Client,
  robot: Robot,
) {
  robot.hear(/help me archive (.+)/, async (msg) => {
    const archiveChannelName = msg.match[1]

    const guild = discordClient.guilds.cache.first()
    if (guild === undefined) {
      msg.send("Failed to resolve Discord server.")
      return
    }
    const channels = await guild.channels.fetch()

    const archiveChannel =
      channels.get(archiveChannelName) ??
      channels.find(
        (channel) =>
          channel !== null &&
          channel.isTextBased() &&
          !channel.isDMBased() &&
          channel.name.toLowerCase() === archiveChannelName.toLowerCase(),
      ) ??
      undefined

    if (archiveChannel === undefined) {
      msg.send("No matching channel found.")
      return
    }

    const archiveThreshold = weekdaysBefore(moment(), 14)

    // channels
    Array.from([archiveChannel])
      .filter(
        (channel): channel is TextChannel =>
          channel !== null && channel.isTextBased() && channel.viewable,
      )
      .forEach(async (channel) => {
        try {
          const { threads } = await channel.threads.fetch()
          const threadsWithDates = (
            await Promise.all(
              threads.map(async (thread) => {
                const messages = await thread.messages.fetch({ limit: 1 })

                const firstMessage = messages.first()
                const lastActivity = Math.max(
                  firstMessage?.createdTimestamp ?? 0,
                  thread.archiveTimestamp ?? 0,
                )

                return { thread, lastActivity: moment(lastActivity) }
              }),
            )
          ).filter(({ lastActivity }) =>
            lastActivity.isBefore(archiveThreshold),
          )

          threadsWithDates[0]?.thread?.send(
            "@ogshadowfiend check archive status here, please.",
          )
        } catch (err) {
          console.error(
            `Error for ${channel.name}: `,
            err,
            (err as Error).stack,
          )
        }
      })
  })
}
