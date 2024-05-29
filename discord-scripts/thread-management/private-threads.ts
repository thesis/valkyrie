import { AnyThreadChannel, channelMention } from "discord.js"
import { isPrivate } from "../../lib/discord/utils.ts"

const PRIVATE_THREAD_CHANNELS = [
  { id: "1079520580228894771", name: "operations" },
  { id: "1202691029996675104", name: "hiring-and-peopleops" },
  { id: "1218285168888909975", name: "onboarding"},
]

async function privateThreadAdmonishment(
  thread: AnyThreadChannel<boolean>,
): Promise<void> {
  const { parent: containingChannel } = thread

  if (
    isPrivate(thread) &&
    !PRIVATE_THREAD_CHANNELS.some(
      ({ id }) => containingChannel?.id?.toLowerCase() === id,
    )
  ) {
    await thread.send(
      "Private threads should largely only be used for discussions around " +
        "confidential topics like legal and hiring. They should as a result " +
        `almost always be created in one of ${PRIVATE_THREAD_CHANNELS.map(
          ({ id }) => channelMention(id),
        ).join(",")}; if you know you're ` +
        "breaking both rules on purpose, go forth and conquer, but otherwise " +
        "please start the thread there. I'm also going to auto-tag the " +
        "appropriate roles now, which may compromise the privacy of the " +
        "thread (**all members of the role who have access to this channel " +
        "will have access to the thread**).",
    )
  }
}

const eventHandlers = {
  threadCreate: privateThreadAdmonishment,
}

export default eventHandlers
