import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"

const discordClient = new Client({ intents: [] })

discordClient.login(process.env.HUBOT_DISCORD_TOKEN)

const discordWebhook = {
  async sendToDiscordChannel(channelId: string, message: string) {
    const channel = await discordClient.channels.fetch(channelId)

    if (channel && channel.isTextBased()) {
      await (channel as TextChannel).send(message)
    } else {
      throw new Error("Channel is not text-based or not found")
    }
  }
}

export default discordWebhook
