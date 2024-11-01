import {
  Channel,
  ChannelType,
  AnyThreadChannel,
  ClientEvents,
  ThreadChannel,
} from "discord.js"
import { Robot } from "hubot"
import { DiscordBot } from "hubot-discord"

// The base role id used for base permissions across org
// members.
const BASE_ROLE_ID = "1158333090494689290"

// Channels that are used for testing, may be treated differently.
const TESTING_CHANNEL_NAMES = ["stackops", "acre-engineering", "mezo-engineering-core"]

/**
 * Hubot Robot type with Discord adapter.
 */
export type DiscordHubot = Hubot.Robot<DiscordBot>

/**
 * Available handlers for thread management, all taking the Hubot robot as
 * their last param.
 */
export type DiscordEventHandlers = {
  [Event in keyof ClientEvents]?: (
    ...params: [...ClientEvents[Event], Robot]
  ) => Promise<void>
}

// Category that is treated as recreational, i.e. the rules don't apply baby.
export const RECREATIONAL_CATEGORY_ID = "1079492118692757605"

/**
 * Checks if a given thread is within a channel used for Hubot testing. At
 * times, these channels may be subjected to laxer restrictions.
 */
export function isInTestingChannel(threadChannel: ThreadChannel): boolean {
  return (
    TESTING_CHANNEL_NAMES.indexOf(
      threadChannel.parent?.name?.toLowerCase() ?? "",
    ) !== -1
  )
}

/**
 * Checks if a given channel is within the category considered "recreational".
 * The recreational category contains channels that less formal and aren't
 * subject to the usual rules meant to drive content organization and
 * decision-making.
 */
export function isInRecreationalCategory(
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

/**
 * Checks if a given channel is private. This works across threads, categories,
 * and voice and text channels. It does _not_ report DM channels as private, as
 * it is designed for use on servers rather than in DMs.
 */
export function isPrivate(channel: Channel | undefined | null): boolean {
  if (
    channel === undefined ||
    channel === null ||
    channel.isDMBased() ||
    channel.parent === null
  ) {
    return false
  }

  // Private and public threads get clear channel types.
  if (channel.type === ChannelType.PrivateThread) {
    return true
  }

  if (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.AnnouncementThread
  ) {
    return false
  }

  // This cast is needed because the PublicThread/AnnouncementThread
  // conditional above doesn't correctly filter out
  // PublicThreadChannel<boolean> from the type list, even though it does
  // practically exclude them.
  const knownNonThreadChannel = channel as Exclude<
    typeof channel,
    AnyThreadChannel
  >

  // For other channels, check if the defined base role has view
  // channel access.
  //
  // NOTE: The way the Thesis Discord is set up, the base
  // "@everyone" role does NOT have view access; however,
  // the base role identified by BASE_ROLE_ID does.
  const everyoneCanView =
    knownNonThreadChannel.permissionsFor(BASE_ROLE_ID)?.has("ViewChannel") ??
    false

  return !everyoneCanView
}
