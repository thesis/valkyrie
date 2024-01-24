import { AnyThreadChannel, ThreadChannel } from "discord.js"
import { Adapter, Brain } from "hubot"

const CHANNEL_METADATA_KEY = "discord-channel-metadata"

/**
 * Available features that can be enabled or disabled in a given channel or
 * category.
 */
export type HubotFeature = "archive-checking"

/**
 * Metadata tracked about a channel, using the Discord definition of a channel
 * (which may include categories, threads, forums, etc).
 */
type ChannelMetadata = {
  /**
   * A list of Hubot features permitted in this channel.
   */
  permittedFeatures: HubotFeature[]
}

/**
 * Metadata tracked about a thread channel.
 */
type ThreadMetadata = ChannelMetadata & {
  /**
   * When true, the thread is currently considered to be a synchronous thread,
   * meaning it has not had significant periods of dormancy and is likely
   * engaging its participants in a roughly synchronous conversation. Once this
   * flips to `false`, it remains that way.
   */
  sync: boolean
}

/**
 * Channel metadata tracked by channel id, used for storing in the Hubot brain.
 */
type AvailableChannelMetadata = {
  [channelId: string]: ThreadMetadata | ChannelMetadata | undefined
}

/**
 * Thread metadata tracked by channel id; used to narrow the
 * AvailableChannelMetadata type.
 */
type AvailableThreadMetadata = {
  [key in keyof AvailableChannelMetadata]: ThreadMetadata
}

/**
 * Fetches all available channel metadata from the Hubot brain.
 */
export function getAllChannelMetadata(
  brain: Brain<Adapter>,
): AvailableChannelMetadata {
  return (
    (JSON.parse(brain.get(CHANNEL_METADATA_KEY) ?? "{}") as
      | AvailableChannelMetadata
      | undefined) ?? {}
  )
}

/**
 * Fetches all available thread metadata from the Hubot brain, filtering down
 * the channel metadata to just threads.
 */
export function getAllThreadMetadata(
  brain: Brain<Adapter>,
): AvailableThreadMetadata {
  return Object.fromEntries(
    Object.entries(getAllChannelMetadata(brain)).filter(
      ([, metadata]) => metadata !== undefined && "sync" in metadata,
    ) as [string, ThreadMetadata][],
  )
}

export function getThreadMetadata(
  brain: Brain<Adapter>,
  thread: ThreadChannel,
): ThreadMetadata | undefined {
  return getAllThreadMetadata(brain)[thread.id]
}

export function updateThreadMetadata(
  brain: Brain<Adapter>,
  thread: ThreadChannel,
  updatedMetadata: Partial<ThreadMetadata> | undefined,
): void {
  const { [thread.id]: existingThreadMetadata, ...otherChannelMetadata } =
    getAllThreadMetadata(brain)

  const updatedAvailableMetadata: AvailableChannelMetadata =
    updatedMetadata === undefined
      ? otherChannelMetadata
      : {
          ...otherChannelMetadata,
          [thread.id]: { ...existingThreadMetadata, ...updatedMetadata },
        }

  brain.set(CHANNEL_METADATA_KEY, JSON.stringify(updatedAvailableMetadata))
}

export function isInPermittedCategoryOrChannel(
  brain: Brain<Adapter>,
  thread: AnyThreadChannel<boolean>,
  permittedFeature: HubotFeature,
) {
  const threadChannelId = thread.parentId ?? undefined
  const threadCategoryId = thread.parent?.parentId ?? undefined

  if (threadChannelId === undefined) {
    return false
  }

  const channelHierarchyIds = {
    [thread.id]: true,
    [threadChannelId]: true,
    ...(threadCategoryId === undefined ? {} : { [threadCategoryId]: true }),
  }

  return Object.entries(getAllChannelMetadata(brain)).some(
    ([channelId, metadata]) =>
      metadata !== undefined &&
      "allowedFunctions" in metadata &&
      channelHierarchyIds[channelId] &&
      metadata.permittedFeatures.includes(permittedFeature),
  )
}
