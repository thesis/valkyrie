import { Channel, Client } from "discord.js"
import { isPrivate } from "../lib/discord/utils.ts"

async function ensurePrivacyEmoji(channel: Channel) {
  if (channel.isDMBased()) {
    return
  }

  if (isPrivate(channel)) {
    if (!channel.name.startsWith("🔒")) {
      await channel.setName(`🔒 ${channel.name.replace(/^ +/, "")}`)
    }
  }
}

// Ensures private channels and threads are always prefixed by the lock emoji
// (🔒) for clear visibility in the sidebar.
export default function privacyTagging(discordClient: Client) {
  discordClient.on("threadCreate", ensurePrivacyEmoji)
  discordClient.on("threadUpdate", ensurePrivacyEmoji)
  discordClient.on("channelCreate", ensurePrivacyEmoji)
  discordClient.on("channelUpdate", ensurePrivacyEmoji)
}
