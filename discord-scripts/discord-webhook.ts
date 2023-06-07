import { Client, TextChannel } from "discord.js"
import { Robot } from "hubot"
import express from "express"

export default async function webhookDiscord(
  discordClient: Client,
  robot: Robot<any>,
) {
  async function sendToDiscordChannel(
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
  }
  if (process.env.HUBOT_WEBHOOK_URL) {
    const webhookUrl = process.env.HUBOT_WEBHOOK_URL

    robot.router.post(
      `${webhookUrl}`,
      async (req: express.Request, res: express.Response) => {
        const { channelId, tagUser, title, message } = req.body

        robot.logger.info(
          `Received data: channelId = ${channelId}, title = ${title}, tagged users = ${tagUser} , message = ${message}`,
        )
        await sendToDiscordChannel(channelId, tagUser, title, message)

        res.status(200).send("Message sent to Discord")
      },
    )
  }
}
