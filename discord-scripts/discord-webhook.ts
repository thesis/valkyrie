import { Client, TextChannel, ChannelType } from "discord.js"
import { Robot } from "hubot"
import express from "express"

export default async function webhookDiscord(
  discordClient: Client,
  robot: Robot,
) {
  async function sendToDiscordChannel(
    channelName: string,
    tagUser: string,
    title: string,
    message: string,
  ) {
    let channel: TextChannel | undefined
    const guilds = discordClient.guilds.cache

    guilds.forEach((guild) => {
      const matchedChannel = guild.channels.cache.find(
        (ch) => ch.name === channelName && ch.type === ChannelType.GuildText,
      )

      if (matchedChannel && matchedChannel.type === ChannelType.GuildText) {
        channel = matchedChannel as TextChannel
      }
    })

    if (!channel)
      throw new Error(
        "Text-based channel with the given name not found in any guild",
      )

    const memberIds = tagUser.split(",")
    const existingThread = channel.threads.cache.find(
      (thread) => thread.name === title,
    )

    if (existingThread) {
      await existingThread.send("@here")
      await existingThread.send(message)
    } else {
      const newThread = await channel.threads.create({
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
  }

  if (process.env.HUBOT_WEBHOOK_URL) {
    const webhookUrl = process.env.HUBOT_WEBHOOK_URL
    const requiredAuth = process.env.HUBOT_WEBHOOK_AUTH

    robot.router.post(
      `${webhookUrl}`,
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== requiredAuth) {
          res.status(401).send("Unauthorized")
        } else {
          next()
        }
      },
      async (req: express.Request, res: express.Response) => {
        const { channelName, tagUser, title, message } = req.body

        robot.logger.info(
          `Received data: channelName = ${channelName}, title = ${title}, tagged users = ${tagUser} , message = ${message}`,
        )
        await sendToDiscordChannel(channelName, tagUser, title, message)

        res.status(200).send("Message sent to Discord")
      },
    )
  }
}
