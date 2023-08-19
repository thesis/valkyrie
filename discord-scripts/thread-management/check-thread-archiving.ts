import {
  APIButtonComponentWithCustomId,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ComponentEmojiResolvable,
  ComponentType,
  Interaction,
  Message,
  PublicThreadChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  UserSelectMenuBuilder,
  userMention,
} from "discord.js"
import { Robot } from "hubot"
import { MINUTE, SECOND } from "../../lib/globals.ts"
import {
  DiscordEventHandlers,
  isInRecreationalCategory,
  isInTestingChannel,
} from "../../lib/discord/utils.ts"

const MAX_HEURISTIC_SYNC_THREAD_DURATION = 60 * MINUTE
const CHANNEL_METADATA_KEY = "discord-channel-metadata"
const THREAD_CHECK_CADENCE = 5 * SECOND
// Use a ThreadAutoArchiveDuration as we'll still lean on Discord to
// auto-archive after issuing the warning, so we want the value to be
// one that we can update auto-archiving to.
const AUTO_ARCHIVE_WARNING_LEAD_MINUTES: ThreadAutoArchiveDuration =
  ThreadAutoArchiveDuration.OneDay

type ThreadMetadata = {
  sync?: boolean
}
type AvailableThreadMetadata = {
  [threadId: string]: ThreadMetadata | undefined
}

function getAllThreadMetadata(robot: Robot): AvailableThreadMetadata {
  return (
    (JSON.parse(robot.brain.get(CHANNEL_METADATA_KEY) ?? "{}") as
      | AvailableThreadMetadata
      | undefined) ?? {}
  )
}

const threadActions: {
  [action: string]: Pick<APIButtonComponentWithCustomId, "label"> & {
    handler: (thread: ThreadChannel, interaction: ButtonInteraction) => void
    extendAutoArchive: boolean
    emoji: ComponentEmojiResolvable
  }
} = {
  "check-thread-archiving-finished-button": {
    label: "Nothing; all done!",
    emoji: "☑️",
    extendAutoArchive: false,
    handler: async (thread, interaction) => {
      await interaction.reply({
        content: "Sounds like this thread is ready to archive, doing that now!",
      })
      thread.setArchived(true)
    },
  },
  "check-thread-archiving-task-button": {
    label: "Needs a task captured",
    emoji: "🔲",
    extendAutoArchive: true,
    handler: async (thread, interaction) => {
      const posterSelectId = `task-poster-select-${interaction.id}`

      const initialReply = await interaction.reply({
        ephemeral: true,
        content:
          "Who needs to capture the task? This thread will still auto-archive " +
          "in ~24 hours.",
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              new UserSelectMenuBuilder({
                customId: posterSelectId,
                minValues: 1,
                maxValues: 1,
                placeholder: "Task capturer 📝",
              }),
            ],
          },
        ],
      })

      const selectInteraction =
        await thread.awaitMessageComponent<ComponentType.UserSelect>({
          componentType: ComponentType.UserSelect,
          filter: (posterInteraction) =>
            posterInteraction.customId === posterSelectId,
        })

      const [userIdToTag] = selectInteraction.values

      thread.send({
        content:
          `${userMention(
            userIdToTag,
          )} please capture the task(s) associated with this thread today; ` +
          "it will be auto-archived in 24 hours ❤️",
      })
      initialReply.delete()
    },
  },
  "check-thread-archiving-status-button": {
    label: "Needs a status posted",
    emoji: "✍️",
    extendAutoArchive: false,
    handler: async (thread, interaction) => {
      const posterSelectId = `status-poster-select-${interaction.id}`

      const initialReply = await interaction.reply({
        ephemeral: true,
        content:
          "Who needs to post the status? This thread will still auto-archive " +
          "in ~24 hours without an update.",
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              new UserSelectMenuBuilder({
                customId: posterSelectId,
                minValues: 1,
                maxValues: 1,
                placeholder: "Updater 📣",
              }),
            ],
          },
        ],
      })

      const selectInteraction =
        await thread.awaitMessageComponent<ComponentType.UserSelect>({
          componentType: ComponentType.UserSelect,
          filter: (posterInteraction) =>
            posterInteraction.customId === posterSelectId,
        })

      const [userIdToTag] = selectInteraction.values

      thread.send({
        content:
          `${userMention(
            userIdToTag,
          )} please post your latest status on this thread or it ` +
          "will be archived in 24 hours ❤️",
      })
      initialReply.delete()
    },
  },
  "check-thread-archiving-pending-decision-button": {
    label: "Needs a decision",
    emoji: "🫵",
    extendAutoArchive: true,
    handler: async (thread, interaction) => {
      const posterSelectId = `decision-poster-select-${interaction.id}`

      const initialReply = await interaction.reply({
        ephemeral: true,
        content:
          "Who needs to post the decision? This thread will still auto-archive " +
          "in ~24 hours without an update.",
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              new UserSelectMenuBuilder({
                customId: posterSelectId,
                minValues: 1,
                maxValues: 1,
                placeholder: "Decider 🧑‍⚖️",
              }),
            ],
          },
        ],
      })

      const selectInteraction =
        await thread.awaitMessageComponent<ComponentType.UserSelect>({
          componentType: ComponentType.UserSelect,
          filter: (posterInteraction) =>
            posterInteraction.customId === posterSelectId,
        })

      const [userIdToTag] = selectInteraction.values

      thread.send({
        content:
          `${userMention(
            userIdToTag,
          )} please post and capture the decision for this thread or it ` +
          "will be archived in 24 hours ❤️",
      })
      initialReply.delete()
    },
  },
}

function getThreadMetadata(
  robot: Robot,
  thread: ThreadChannel,
): ThreadMetadata | undefined {
  return getAllThreadMetadata(robot)[thread.id]
}

function updateThreadMetadata(
  robot: Robot,
  thread: ThreadChannel,
  updatedMetadata: ThreadMetadata | undefined,
): void {
  const { [thread.id]: _, ...otherChannelMetadata } =
    getAllThreadMetadata(robot) ?? {}

  const updatedAvailableMetadata =
    updatedMetadata === undefined
      ? otherChannelMetadata
      : { ...otherChannelMetadata, [thread.id]: updatedMetadata }

  robot.brain.set(
    CHANNEL_METADATA_KEY,
    JSON.stringify(updatedAvailableMetadata),
  )
}

// Updates a thread to indicate whether it's a sync conversation.
//
// This uses a heuristic approach (see the code) to guess whether the
// converesation is relatively rapid-fire and relatively short. Sync
// conversations are exempt from prompts to avoid archiving.
async function updateThreadStatusFromMessage(
  message: Message<boolean>,
  robot: Robot,
) {
  // If this isn't in a thread, we're not interested; if it is and it's in the
  // recreational category, we're also not interested.
  const { channel: thread, createdTimestamp: messageTimestamp } = message
  if (
    !thread.isThread() ||
    isInRecreationalCategory(thread) ||
    !isInTestingChannel(thread) // FIXME drop once tested
  ) {
    return
  }

  robot.logger.info("OHAI I am about to do this")

  const channelMetadata = getThreadMetadata(robot, thread) ?? { sync: true }

  if (
    channelMetadata.sync &&
    messageTimestamp - (thread.createdTimestamp ?? 0) >
      0 /* MAX_HEURISTIC_SYNC_THREAD_DURATION */
  ) {
    robot.logger.info("Marking thread", thread.id, "as async")
    channelMetadata.sync = false
    updateThreadMetadata(robot, thread, channelMetadata)
  }
}

async function updateThreadStatusFromAction(
  interaction: Interaction,
  robot: Robot,
): Promise<void> {
  if (interaction.isButton() && interaction.customId in threadActions) {
    const { channel: thread, customId: interactionId } = interaction

    robot.logger.info(
      "Got an interaction that feels right, and it is",
      interactionId,
    )

    if (thread?.isThread()) {
      threadActions[interactionId as keyof typeof threadActions].handler(
        thread,
        interaction,
      )
    }
  }
}

// Stop tracking metadata for archived threads, and assume unarchived threads are async.
async function updateThreadStatusFromThread(
  oldThread: ThreadChannel,
  updatedThread: ThreadChannel,
  robot: Robot,
) {
  // If it's a recreational thread, we don't care.
  // `as` casting due to some weird internal Discord type discrepancies that
  // make updatedThread appear not to fit the type `Channel` even though
  // `ThreadChannel` should always fit.
  if (isInRecreationalCategory(updatedThread as PublicThreadChannel)) {
    return
  }

  if (!isInTestingChannel(updatedThread)) {
    return // FIXME drop once tested
  }

  if (
    updatedThread.archived === true &&
    getThreadMetadata(robot, updatedThread) !== undefined
  ) {
    // Clear metadata for an archived thread.
    updateThreadMetadata(robot, updatedThread, undefined)
  }

  // Force sync to false for an unarchived thread that was updated.
  if (
    oldThread.archived === true &&
    updatedThread.archived === false &&
    getThreadMetadata(robot, updatedThread)?.sync !== false
  ) {
    updateThreadMetadata(robot, updatedThread, { sync: false })
  }
}

async function checkThreadStatus(
  robot: Robot,
  discordClient: Client,
): Promise<void> {
  const threadMetadataByThreadId = getAllThreadMetadata(robot)
  Object.entries(threadMetadataByThreadId)
    .filter(([, metadata]) => metadata?.sync === false)
    .forEach(async ([threadId]) => {
      const thread = discordClient.channels.cache.get(threadId)

      if (thread === undefined || !thread.isThread()) {
        return
      }

      const lastMessage =
        thread.lastMessage ??
        (thread.lastMessageId !== null
          ? await thread.messages.fetch(thread.lastMessageId)
          : undefined)
      const firstActiveTimestamp = thread.createdTimestamp ?? 0
      const lastActiveTimestamp =
        lastMessage?.createdTimestamp ?? firstActiveTimestamp

      // About a day before the thread auto-archives, issue a warning that it will
      // be archived and ask for follow up, then set the thread to auto-archive
      // after a day.
      if (
        lastActiveTimestamp - (firstActiveTimestamp ?? 0) >
        (thread.autoArchiveDuration ?? 0) * MINUTE -
          /* AUTO_ARCHIVE_WARNING_LEAD_MINUTES */ (thread.autoArchiveDuration ??
            0) *
            MINUTE
      ) {
        await thread.send({
          content:
            "This thread will be auto-archived in 24 hours without further updates; what's next?",
          components: [
            {
              type: ComponentType.ActionRow,
              components: Object.entries(threadActions).map(
                ([actionId, { label, emoji }]) =>
                  ButtonBuilder.from({
                    type: ComponentType.Button,
                    style: ButtonStyle.Primary,
                    custom_id: actionId,
                    label,
                  }).setEmoji(emoji),
              ),
            },
          ],
        })

        // Set to auto-archive to the lead time so Discord handles
        // auto-archiving for us.
        await thread.setAutoArchiveDuration(AUTO_ARCHIVE_WARNING_LEAD_MINUTES)
      }
    })
}

const eventHandlers: DiscordEventHandlers = {
  messageCreate: updateThreadStatusFromMessage,
  threadUpdate: updateThreadStatusFromThread,
  interactionCreate: updateThreadStatusFromAction,
}

export function setup(robot: Robot, discordClient: Client) {
  setInterval(
    () => checkThreadStatus(robot, discordClient),
    THREAD_CHECK_CADENCE,
  )
}

export default eventHandlers
