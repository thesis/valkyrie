import fs from "fs"
import Hubot from "hubot"
import { DiscordBot } from "hubot-discord"
import { Client } from "discord.js"
import path from "path"

// A script with a default export that takes a Discord client and returns
// nothing.
type DiscordScript = {
  default: (client: Client, robot: Hubot.Robot<DiscordBot>) => void
}

function attachWithAdapter(robot: Hubot.Robot) {
  if (robot.adapter instanceof DiscordBot) {
    const { client } = robot.adapter

    if (client !== undefined) {
      fs.readdirSync("./discord-scripts")
        .sort()
        .filter((file) => [".ts", ".js"].includes(path.extname(file)))
        .map((file) => import(path.join("..", "discord-scripts", file)))
        .map(async (discordScript: Promise<DiscordScript>) =>
          (await discordScript).default(
            client,
            robot as Hubot.Robot<DiscordBot>,
          ),
        )
    }
  }
}

export default function attachDiscordScripts(robot: Hubot.Robot) {
  const { adapter } = robot

  if (adapter === undefined || adapter === null) {
    robot.events.once("adapter-initialized", attachWithAdapter)
  } else {
    attachWithAdapter(robot)
  }
}
