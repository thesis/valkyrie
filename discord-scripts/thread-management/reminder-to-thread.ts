import { Message } from "discord.js"
import {
  DiscordEventHandlers,
  isInRecreationalCategory,
} from "../../lib/discord/utils.ts"

// Emoji used to suggest a thread.
export const THREAD_EMOJI = "🧵"

// Remind users to create a thread with a reacji for reply chains longer than
// 1 reply. Skip for messages in the recreational category.
async function reminderToThread(message: Message<boolean>) {
  // If we're already in a thread or this is the recreational category, do
  // nothing.
  const { channel } = message
  if (channel.isThread() || isInRecreationalCategory(channel)) {
    return
  }

  // If this message is not in reply to anything, do nothing.
  if (message.reference === null || message.reference.messageId === undefined) {
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
}

const eventHandlers: DiscordEventHandlers = {
  messageCreate: reminderToThread,
}

export default eventHandlers
