import fs from "fs"
import Hubot, { Adapter } from "hubot"
import { DiscordBot } from "hubot-discord"
import { Client } from "discord.js"
import path from "path"

// A script with a default export that takes a Discord client and returns
// nothing.
type DiscordScript = { default: (client: Client) => void }

function attachWithAdapter(adapter: Adapter) {
  if (adapter instanceof DiscordBot) {
    const { client } = adapter

    if (client !== undefined) {
      fs.readdirSync("./discord-scripts")
        .sort()
        .filter((file) => [".ts", ".js"].includes(path.extname(file)))
        .map((file) => import(path.join("..", "discord-scripts", file)))
        .map(async (discordScript: Promise<DiscordScript>) =>
          (await discordScript).default(client),
        )
    }
  }
}

export default function attachDiscordScripts(hubot: Hubot.Robot) {
  const { adapter } = hubot

  if (adapter === undefined || adapter === null) {
    hubot.events.once("adapter-initialized", attachWithAdapter)
  } else {
    attachWithAdapter(adapter)
  }
}
