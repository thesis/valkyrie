import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"

const discordClient = new Client({ intents: [] })

discordClient.login(process.env.HUBOT_DISCORD_TOKEN)

const discordWebhook = {
  async sendToDiscordChannel(channelId: string, title: string, message: string) {
    const channel = await discordClient.channels.fetch(channelId)
    if (channel && channel.isTextBased()) {
      const webhookThread = await (channel as TextChannel).threads.create({
        name: title,
        autoArchiveDuration: 60,
        reason: message,
      })
      await webhookThread.send(message)
    } else {
      throw new Error("Channel is not text-based or not found")
    }
  }
}

export default discordWebhook
