import { ChannelType, Client, TextChannel } from "discord.js"
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
  robot.hear(/blow everything up/, async (msg) => {
    const guild = discordClient.guilds.cache.first()
    if (guild === undefined) {
      msg.send("No guild found.")
      return
    }
    const channels = await guild.channels.fetch()
    const archiveThreshold = weekdaysBefore(moment(), 4)
    channels
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

          const message = `Threads to archive for ${
            channel.name
          }:\n- ${threadsWithDates
            .map(
              ({ thread, lastActivity }) =>
                `${
                  thread.type === ChannelType.PrivateThread
                    ? "[private]"
                    : thread.name
                }: ${lastActivity.toLocaleString()}`,
            )
            .join("\n- ")}`
          console.log(message)
          msg.reply(message)
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
