import { PartialMessage, Client, Message } from "discord.js"

async function workingTwitterEmbeds(
  message: Message<boolean> | PartialMessage,
) {
  if (message.author === null || message.author === undefined) {
    return
  }

  if (!message.author.bot) {
    const content = message.content ?? ""
    if (content.match(/(https:\/\/(x|twitter).com\/[a-zA-Z0-9%/_+]+)/)) {
      const allLinks = Array.from(
        content.matchAll(/(https:\/\/(x|twitter).com\/[a-zA-Z0-9%/_+]+)/g),
      )
        .map(([twitterLink]) =>
          twitterLink.replace(/https:\/\/(x|twitter)/, "https://fxtwitter"),
        )
        .join(" , ")

      await message.channel.send(allLinks)
    }
  }
}

// Follows up any message with 1+ Twitter links (including x.com) with a
// message that includes fxtwitter links, which correctly embed into Discord,
// expand t.co links, and have a couple of other nice features.
//
// See https://github.com/FixTweet/FxTwitter for more.
export default function fixTwitterEmbeds(discordClient: Client) {
  discordClient.on("messageCreate", (message) => {
    workingTwitterEmbeds(message)
  })

  discordClient.on("messageUpdate", (_, newMessage) => {
    workingTwitterEmbeds(newMessage)
  })
}
