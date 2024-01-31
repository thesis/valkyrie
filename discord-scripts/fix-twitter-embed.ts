import { PartialMessage, Client, Message } from "discord.js"
import { Log, Robot } from "hubot"

const twitterUrlRegExp = /(https:\/\/(x|twitter).com\/[a-zA-Z0-9%/_+]+)/g

function extractUniqueTwitterLinks(
  message: Message<boolean> | PartialMessage,
): string[] {
  const twitterEmbedUrls = message.embeds
    .map(({ url }) => url)
    .filter((url) => url?.match(twitterUrlRegExp) ?? false)

  const content = message.content ?? ""
  if (content.match(twitterUrlRegExp)) {
    const allUrl = Array.from(content.matchAll(twitterUrlRegExp)).map(
      ([twitterUrl]) =>
        twitterUrl.replace(/https:\/\/(x|twitter)/, "https://fxtwitter").trim(),
    )

    return allUrl
      .reduce(
        (uniqueUrls, url) =>
          uniqueUrls.includes(url) ? uniqueUrls : [...uniqueUrls, url],
        [] as string[],
      )
      .filter((url) => !twitterEmbedUrls.includes(url))
  }

  return []
}

async function workingTwitterEmbeds(
  message: Message<boolean> | PartialMessage,
  logger: Log,
  oldMessage?: Message<boolean> | PartialMessage,
) {
  if (message.author === null || message.author === undefined) {
    return
  }

  if (!message.author.bot) {
    const existingUrls =
      oldMessage === undefined ? [] : extractUniqueTwitterLinks(oldMessage)
    const latestUrls = extractUniqueTwitterLinks(message).filter(
      (url) => !existingUrls.includes(url),
    )

    logger.info(`workingTwitterEmbeds: extracted [${latestUrls.length}] URLs`)

    if (latestUrls.length > 0) {
      // Kill default embeds in favor of ours <_<
      await message.suppressEmbeds()

      await message.channel.send(latestUrls.join(", "))
    }
  }
}

// Follows up any message with 1+ Twitter links (including x.com) with a
// message that includes fxtwitter links, which correctly embed into Discord,
// expand t.co links, and have a couple of other nice features.
//
// See https://github.com/FixTweet/FxTwitter for more.
export default function fixTwitterEmbeds(discordClient: Client, robot: Robot) {
  discordClient.on("messageCreate", (message) => {
    robot.logger.info(
      `fixTwitterEmbeds: processing new message ${message.content}`,
    )

    workingTwitterEmbeds(message, robot.logger).catch((err) => {
      robot.logger.error(
        `fixTwitterEmbeds: failed to process new message ${message.content}: ${err}`,
      )
    })
  })

  discordClient.on("messageUpdate", (oldMessage, newMessage) => {
    robot.logger.info(
      `fixTwitterEmbeds: processing updated message ${newMessage.content}, ${oldMessage.content}`,
    )

    workingTwitterEmbeds(newMessage, robot.logger, oldMessage).catch((err) => {
      robot.logger.error(
        `fixTwitterEmbeds: failed to process new message ${newMessage.content}: ${err}`,
      )
    })
  })
}
