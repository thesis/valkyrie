import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"

const discordClient = new Client({ intents: [] })

discordClient.login(process.env.HUBOT_DISCORD_TOKEN)

const discordWebhook = {
  async sendToDiscordChannel(channelId: string, tagUser: string, title: string, message: string) {
    const channel = await discordClient.channels.fetch(channelId)
    if (channel && channel.isTextBased()) {
      const channelAsText = channel as TextChannel
      const existingThread = channelAsText.threads.cache.find(thread => thread.name === title)

        if (existingThread) {
          await existingThread.send(`@${tagUser}`)
          await existingThread.send(message)
        } else {
          const newThread = await channelAsText.threads.create({
            name: title,
            autoArchiveDuration: 60,
            reason: message,
          });
          await newThread.send(`@${tagUser}`)
          await newThread.send(message)
        }
      } else {
        throw new Error("Channel is not text-based or not found")
    }
  }
}

export default discordWebhook
