import { Channel, ChannelType, AnyThreadChannel } from "discord.js"
import { DiscordBot } from "hubot-discord"

export type DiscordHubot = Hubot.Robot<DiscordBot>

// Category that is treated as recreational, i.e. the rules don't apply baby.
export const RECREATIONAL_CATEGORY_ID = "1079492118692757605"

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

  // For other channels, heck if the base role has an override to prevent it
  // from viewing the channel.
  //
  // NOTE: The way the Thesis Discord is set up, the base role does NOT have
  // view access; however, channels that are private have an explicit DENY for
  // the view permission. This is what we check for here, considering a channel
  // private ONLY IF it explicitly denies view channel access.
  const everyoneCanView =
    knownNonThreadChannel.permissionOverwrites.cache
      .get(channel.guild.roles.everyone.id)
      ?.allow.has("ViewChannel") ?? true

  return !everyoneCanView
}

export default function booyan() {}
