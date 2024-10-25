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

  async function updateServerNickname(
    userId: string,
    guildId: string,
    addSuffix: boolean,
    nicknameSuffix: string = "(OOO)",
  ) {
    const guild = discordClient.guilds.cache.get(guildId)
    if (!guild) throw new Error("Guild not found")

    const member = await guild.members.fetch(userId)
    if (!member) throw new Error("User not found in this guild")

    const originalNickname = member.nickname || member.user.username
    const hasSuffix = originalNickname.endsWith(nicknameSuffix)

    if (addSuffix && !hasSuffix) {
      await member.setNickname(`${originalNickname} ${nicknameSuffix}`)
      robot.logger.info(
        `Added ${nicknameSuffix} to ${member.user.username} in ${guild.name}`,
      )
    } else if (!addSuffix && hasSuffix) {
      const updatedNickname = originalNickname
        .replace(nicknameSuffix, "")
        .trim()
      await member.setNickname(updatedNickname)
      robot.logger.info(
        `Removed ${nicknameSuffix} from ${member.user.username} in ${guild.name}`,
      )
    }
  }

  if (process.env.HUBOT_WEBHOOK_URL) {
    const webhookUrl = process.env.HUBOT_WEBHOOK_URL
    const requiredAuth = process.env.HUBOT_WEBHOOK_AUTH
    robot.logger.info("Webhook URL has been set: ", webhookUrl)
    robot.logger.info("Webhook Auth has been set: ", requiredAuth)

    const handleAuth = (
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
    }

    robot.router.post(
      `${webhookUrl}`,
      handleAuth,
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

    robot.router.post(`/start-date`, handleAuth, async (req, res) => {
      try {
        const { userId, guildId } = req.body
        if (!userId || !guildId) {
          return res.status(400).send("Missing userId or guildId")
        }

        await updateServerNickname(userId, guildId, true)
        res.status(200).send("Nickname updated to add (OOO)")
      } catch (error) {
        console.error("Error in start-date route:", error)
        res.status(500).send("Internal Server Error")
      }
    })

    robot.router.post(
      `/end-date`,
      handleAuth,
      async (req: express.Request, res: express.Response) => {
        const { userId, guildId } = req.body
        if (!userId || !guildId) {
          return res.status(400).send("Missing userId or guildId")
        }

        await updateServerNickname(userId, guildId, false)
        res.status(200).send("Nickname updated to remove (OOO)")
      },
    )

    robot.logger.info(
      "Webhook is now enabled with OOO routes /start-date and /end-date",
    )
  }
}
