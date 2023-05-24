import { Robot } from "hubot"
import express from "express"
import discordWebhook from "../discord-scripts/discord-webhook.ts"
import { Client, TextChannel, Channel } from "discord.js"

export default function webhookDiscord(robot: Robot, discordClient: Client) {
  // To use as a webhook to pass data directly to Discord channels via webhook URL defined in the .env. Can be tested locally by running
  // curl -X POST -H "Content-Type: application/json" -d '{"channelId": "1099991409878126624", "message": "Hello, world!"}' webhookUrl

  const webhookUrl = process.env.HUBOT_WEBHOOK_URL

  robot.router.post(
    "" + webhookUrl + "",
    async (req: express.Request, res: express.Response) => {
      const channelId = req.body.channelId
      const title = req.body.title
      const message = req.body.message

      robot.logger.info(
        `Received data: channelId = ${channelId}, title = ${title} , message = ${message}`,
      )
      await discordWebhook.sendToDiscordChannel(channelId, title, message)

      res.status(200).send("Message sent to Discord")
    },
  )
}
