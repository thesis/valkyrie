import { Channel, ChannelType, Client } from "discord.js"

// Emoji used to suggest a thread.
const THREAD_EMOJI = "🧵"
// Category that is treated as recreational, i.e. the rules don't apply baby.
const RECREATIONAL_CATEGORY_ID = "1079492118692757605"

function isInRecreationalCategory(
  channel: Channel | undefined | null,
): boolean {
  if (
    channel === undefined ||
    channel === null ||
    channel.isDMBased() ||
    channel.parent === null
  ) {
    return false
  }

  // Channel is inside a category.
  if (channel.parent.type === ChannelType.GuildCategory) {
    return channel.parent.id === RECREATIONAL_CATEGORY_ID
  }

  // Channel's parent is inside a category; this applies to thread channels.
  if (channel.parent.parent !== null) {
    return channel.parent.id === RECREATIONAL_CATEGORY_ID
  }

  return false
}

export default function manageThreads(discordClient: Client) {
  // When a thread is created, join it.
  //
  // Additionally, quietly tag a role so that all members of it are subscribed
  // to the thread (they may later leave the thread to opt out). The role that
  // is tagged is, in order:
  //
  // - If the containing channel's category is recreational, no role.
  // - If the containnig channel has a role with a matching name, that role
  //   (e.g., a message to #tech will tag a Tech role if it exists).
  // - If the containing channel's category has a role with a matching name, that role
  //   (e.g., a message to #taho-standup inside the Taho category will tag the
  //   Taho role if it exists).
  // - If the containing channel's category is General and the channel is
  //   #main, @everyone.
  discordClient.on("threadCreate", async (thread) => {
    await thread.join()

    if (isInRecreationalCategory(thread)) {
      return
    }

    const { guild: server, parent: containingChannel } = thread

    if (thread.type === ChannelType.GuildPrivateThread) {
      if (!thread.name.startsWith("🔒")) {
        await thread.setName(`🔒 ${thread.name.replace(/^ +/, "")}`)
      }

      if (containingChannel?.name?.toLowerCase() !== "operations") {
        await thread.send(
          "Private threads should largely only be used for discussions around " +
            "confidential topics like legal and hiring. They should as a result " +
            "almost always be created in #operations; if you know you're " +
            "breaking both rules on purpose, go forth and conquer, but otherwise " +
            "please start the thread there. I'm also going to auto-tag the " +
            "appropriate roles now, which may compromise the privacy of the " +
            "thread (**all members of the role who have access to this channel " +
            "will have access to the thread**).",
        )
      }
    }

    const placeholder = await thread.send("<placeholder>")

    const matchingRole = server.roles.cache.find(
      (role) =>
        role.name.toLowerCase() === containingChannel?.name.toLowerCase(),
    )

    if (matchingRole !== undefined) {
      await placeholder.edit(matchingRole.toString())
      return
    }

    const categoryChannel = containingChannel?.parent
    const categoryMatchingRole = server.roles.cache.find(
      (role) => role.name.toLowerCase() === categoryChannel?.name.toLowerCase(),
    )

    if (categoryMatchingRole !== undefined) {
      await placeholder.edit(categoryMatchingRole.toString())
      return
    }

    // Monstrous, delete the useless placeholder and pray for our soul.
    // Placeholder code as we figure out the best way to handle the General
    // category.
    await placeholder.delete()
  })

  // Remind users to create a thread with a reacji for reply chains longer than
  // 1 reply. Skip for messages in the recreational category.
  discordClient.on("messageCreate", async (message) => {
    // If we're already in a thread or this is the recreational category, do
    // nothing.
    const { channel } = message
    if (channel.isThread() || isInRecreationalCategory(channel)) {
      return
    }

    // If this message is not in reply to anything, do nothing.
    if (
      message.reference === null ||
      message.reference.messageId === undefined
    ) {
      return
    }

    // If the message replied to is not in reply to anythinbg, still do nothing.
    const repliedMessage = await message.fetchReference()
    if (
      repliedMessage.reference === null ||
      repliedMessage.reference.messageId === undefined
    ) {
      return
    }

    // Okay, now we've got a chain of two replies, suggest a thread via reacji
    // on the original message---if it is indeed the original message in the
    // chain.
    const potentialOriginalMessage = await repliedMessage.fetchReference()
    if (potentialOriginalMessage.reference === null) {
      message.react(THREAD_EMOJI)
    }
  })
}
