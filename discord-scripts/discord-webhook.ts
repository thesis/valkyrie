import { Client, TextChannel, ChannelType } from "discord.js"
import { Robot } from "hubot"
import express from "express"

export default async function webhookDiscord(
  discordClient: Client,
  robot: Robot,
) {
  async function sendToDiscordChannel(
    channelName: string,
    title: string,
    message: string,
    tagUser: string = "0", // 0 means no user is tagged
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

    const existingThread = channel.threads.cache.find(
      (thread) => thread.name === title,
    )

    if (existingThread) {
      await existingThread.send(message)
    } else {
      const newThread = await channel.threads.create({
        name: title,
        reason: message,
      })
      if (tagUser !== "0") {
        const memberIds = tagUser.split(",")
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
    robot.logger.info("Webhook URL has been set: ", webhookUrl)
    robot.logger.info("Webhook Auth has been set: ", requiredAuth)
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
        const isBodyInvalid = ["channelName", "title", "message"].some(
          (field) => {
            const isFieldEmpty = !req.body?.[field]

            if (isFieldEmpty) {
              res.status(400).send(`Missing field: ${field}`)
            }
            return isFieldEmpty
          },
        )

        if (isBodyInvalid) {
          return
        }

        const { channelName, tagUser, title, message } = req.body

        robot.logger.info(
          `Received data: channelName = ${channelName}, title = ${title}, tagged users = ${tagUser} , message = ${message}`,
        )
        await sendToDiscordChannel(channelName, title, message, tagUser)

        res.status(200).send("Message sent to Discord")
      },
    )
    robot.logger.info("Webhook is now enabled")
  }
}
