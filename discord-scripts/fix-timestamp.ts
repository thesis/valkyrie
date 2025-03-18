import {
  Client,
  Message,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
} from "discord.js"

const TIME_REGEX =
  /\/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}):(\d{2})/i

function toDiscordTimestamp(date: Date) {
  const unixTimestamp = Math.floor(date.getTime() / 1000)
  return `<t:${unixTimestamp}:t>`
}

export default async function timeConverter(discordClient: Client) {
  discordClient.on("messageCreate", async (message: Message) => {
    if (
      message.author.bot ||
      !(
        message.channel instanceof TextChannel ||
        message.channel instanceof ThreadChannel ||
        message.channel instanceof VoiceChannel
      )
    ) {
      return
    }

    const match = message.content.match(TIME_REGEX)
    if (!match) return

    const [, day, hours, minutes] = match
    const now = new Date()

    let targetDate = new Date()
    targetDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0)

    if (day.toLowerCase() === "tomorrow") {
      targetDate.setDate(targetDate.getDate() + 1)
    } else if (day.toLowerCase() !== "today") {
      const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ]
      const targetDayIndex = daysOfWeek.indexOf(day.toLowerCase())
      if (targetDayIndex === -1) return

      let currentDayIndex = now.getDay()
      let daysAhead = targetDayIndex - currentDayIndex
      if (daysAhead <= 0) {
        daysAhead += 7
      }
      targetDate.setDate(now.getDate() + daysAhead)
    }

    const discordTimestamp = toDiscordTimestamp(targetDate)

    try {
      await message.reply({
        content: `**Timestamp: ${discordTimestamp}**`,
        allowedMentions: { repliedUser: false },
      })
    } catch (error) {
      console.error("❌ Failed to reply with timestamp:", error)
    }
  })
}
