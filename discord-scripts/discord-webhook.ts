import { Client, TextChannel } from "discord.js"

const discordClient = new Client({ intents: [] })

discordClient.login(process.env.HUBOT_DISCORD_TOKEN)

const discordWebhook = {
  async sendToDiscordChannel(
    channelId: string,
    tagUser: string,
    title: string,
    message: string,
  ) {
    const channel = await discordClient.channels.fetch(channelId)
    if (channel && channel.isTextBased()) {
      const channelAsText = channel as TextChannel
      const memberIds = tagUser.split(",")
      const existingThread = channelAsText.threads.cache.find(
        (thread) => thread.name === title,
      )

      if (existingThread) {
        await existingThread.send("@here")
        await existingThread.send(message)
      } else {
        const newThread = await channelAsText.threads.create({
          name: title,
          autoArchiveDuration: 60,
          reason: message,
        })
        await newThread.send("@here")
        // replace with new user tagging once deployed in new DiscordJS version. Will be updated to add users to the thread dynamically based on
        if (tagUser !== "0") {
          await Promise.all(
            memberIds.map((id) => newThread.members.add(id.trim())),
          )
        }
        await newThread.send(message)
      }
    } else {
      throw new Error("Channel is not text-based or not found")
    }
  },
}

export default discordWebhook
