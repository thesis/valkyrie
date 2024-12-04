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

    if (latestUrls.length === 0) {
      return
    }

    logger.info(`workingTwitterEmbeds: extracted [${latestUrls.length}] URLs`)

    try {
      // Kill default embeds in favor of ours <_<
      await message.suppressEmbeds()
      await message.channel.send(latestUrls.join(", "))
    } catch (err) {
      logger.error(`Error suppressing embeds or sending new links: ${err}`)
    }
  }
}

// Follows up any message with 1+ Twitter links (including x.com) with a
// message that includes fxtwitter links, which correctly embed into Discord,
// expand t.co links, and have a couple of other nice features.
//
// See https://github.com/FixTweet/FxTwitter for more.
export default function fixTwitterEmbeds(discordClient: Client, robot: Robot) {
  const formatMessageDetails = (message: Message) => {
    const user = message.author?.tag || "Unknown User"
    const channel = message.channel || "Unknown Channel"
    const timestamp = message.createdAt.toISOString()
    const messageId = message.id
    return `User: ${user}, Channel: ${channel}, Timestamp: ${timestamp}, Message ID: ${messageId}`
  }

  // Process only messages that match the Twitter URL pattern
  const processTwitterMessage = async (
    message: Message,
    logger: typeof robot.logger,
    oldMessage?: Message,
  ) => {
    const messageDetails = formatMessageDetails(message)

    logger.info(
      `fixTwitterEmbeds: processing message details ${messageDetails}`,
    )

    try {
      await workingTwitterEmbeds(message, logger, oldMessage)
    } catch (err) {
      logger.error(
        `fixTwitterEmbeds: failed to process message ${messageDetails}: ${err}`,
      )
    }
  }

  discordClient.on("messageCreate", (message) => {
    robot.logger.debug(
      `fixTwitterEmbeds: processing new message ${message.content}`,
    )

    if (message.content?.match(twitterUrlRegExp)) {
      processTwitterMessage(message, robot.logger)
    }
  })

  discordClient.on("messageUpdate", (oldMessage, newMessage) => {
    robot.logger.debug(
      `fixTwitterEmbeds: processing updated message ${newMessage.content}`,
    )

    if (
      newMessage.content?.match(twitterUrlRegExp) ||
      oldMessage?.content?.match(twitterUrlRegExp)
    ) {
      processTwitterMessage(
        newMessage as Message,
        robot.logger,
        oldMessage as Message,
      )
    }
  })
}
