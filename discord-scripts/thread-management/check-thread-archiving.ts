import {
  APIButtonComponentWithCustomId,
  APIInteractionGuildMember,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ComponentEmojiResolvable,
  ComponentType,
  GuildMember,
  Interaction,
  Message,
  PublicThreadChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  UserSelectMenuBuilder,
  userMention,
} from "discord.js"
import { Robot } from "hubot"
import { MINUTE, HOUR } from "../../lib/globals.ts"
import {
  DiscordEventHandlers,
  isInRecreationalCategory,
  isInTestingChannel,
} from "../../lib/discord/utils.ts"
import {
  getAllThreadMetadata,
  getThreadMetadata,
  updateThreadMetadata,
} from "../../lib/discord/channel-metadata.ts"

// The maximum time between any two messages after which a thread is considered
// async.
const MAX_HEURISTIC_SYNC_THREAD_DURATION = 60 * MINUTE // 60 * MINUTE
// How frequently threads are checked for archive requirements.
const THREAD_CHECK_CADENCE = 12 * HOUR // 12 * HOUR
// Use a ThreadAutoArchiveDuration as we'll still lean on Discord to
// auto-archive after issuing the warning, so we want the value to be
// one that we can update auto-archiving to.
const AUTO_ARCHIVE_WARNING_LEAD_MINUTES: ThreadAutoArchiveDuration =
  ThreadAutoArchiveDuration.OneDay

/**
 * A helper to request follow-up action on a thread based on the id of the user
 * who will follow up and the initial requester of follow-up action.
 */

const getNickname = async (interaction: ButtonInteraction): Promise<string> => {
  const { user, guild } = interaction

  if (!guild) {
    return user.username
  }
  const member = await guild.members.fetch(user.id)
  return member.nickname || user.username
}

async function requestFollowUpAction(
  thread: ThreadChannel<boolean>,
  interaction: ButtonInteraction,
  followUpRequester: GuildMember | APIInteractionGuildMember | null,
  requestedAction: string,
  followUpUserId: string,
  robot?: Robot,
) {
  const requestingUserId = followUpRequester?.user.id
  const currentTime = Date.now()
  const followUpDeadline = Math.floor((currentTime + 24 * HOUR) / 1000)

  const nickname = await getNickname(interaction)

  if (followUpUserId === requestingUserId) {
    // If the user designates themselves, delete the initial bot message to remove the dropdown
    interaction.deleteReply().catch((error) => {
      robot?.logger.info("Failed to delete dropdown message:", error)
    })

    interaction
      .followUp({
        content: `Thanks ${userMention(
          requestingUserId,
        )}, please ${requestedAction} this thread or it will be archived in <t:${followUpDeadline}:F> (<t:${followUpDeadline}:R> ❤️)`,
        ephemeral: true,
      })
      .catch((error) => {
        robot?.logger.info("Failed to send ephemeral follow-up message:", error)
      })
  } else {
    // If another user is designated, send a message in the thread tagging them
    thread
      .send({
        content: `${userMention(
          followUpUserId,
        )} please ${requestedAction} this thread or it will be archived in <t:${followUpDeadline}:F> (<t:${followUpDeadline}:R>) - ❤️ Love, ${nickname}`,
      })
      .catch((error) => {
        robot?.logger.info("Failed to send message in thread:", error)
      })

    interaction.deleteReply().catch((error) => {
      robot?.logger.info("Failed to delete initial bot message:", error)
    })
  }
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
      const nickname = await getNickname(interaction)
      await interaction.reply({
        content: "Sounds like this thread is ready to archive, doing that now!",
        ephemeral: true,
      })
      await thread.setArchived(true)

      await interaction.message.edit({
        content: `${interaction.message.content}\n\n☑️ **Archived** by ${nickname}`,
        components: [],
      })
    },
  },
  "check-thread-archiving-task-button": {
    label: "Needs a task captured",
    emoji: "🔲",
    extendAutoArchive: true,
    handler: async (thread, interaction) => {
      const posterSelectId = `task-poster-select-${interaction.id}`
      await interaction.reply({
        ephemeral: true,
        content:
          "Who needs to capture the task? This thread will still auto-archive in ~24 hours.",
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

      requestFollowUpAction(
        thread,
        interaction,
        interaction.member,
        "capture the task(s) associated with",
        userIdToTag,
      )

      await interaction.message.delete()
    },
  },
  "check-thread-archiving-status-button": {
    label: "Needs a status posted",
    emoji: "✍️",
    extendAutoArchive: false,
    handler: async (thread, interaction) => {
      const posterSelectId = `status-poster-select-${interaction.id}`
      await interaction.reply({
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

      requestFollowUpAction(
        thread,
        interaction,
        interaction.member,
        "post a status associated with",
        userIdToTag,
      )

      await interaction.message.delete()
    },
  },
  "check-thread-archiving-pending-decision-button": {
    label: "Needs a decision",
    emoji: "🫵",
    extendAutoArchive: true,
    handler: async (thread, interaction) => {
      const posterSelectId = `decision-poster-select-${interaction.id}`
      await interaction.reply({
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

      requestFollowUpAction(
        thread,
        interaction,
        interaction.member,
        "make a decision for",
        userIdToTag,
      )

      await interaction.message.delete()
    },
  },
}

// Updates a thread to indicate whether it's a sync conversation.
//
// This uses a heuristic approach (see the code) to guess whether the
// conversation is relatively rapid-fire and relatively short. Sync
// conversations are exempt from prompts meant to avoid archiving without
// follow-up actions.
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
    // !isInPermittedCategoryOrChannel(robot.brain, thread, "archive-checking") ||
    !isInTestingChannel(thread) // FIXME drop once tested
  ) {
    return
  }

  const { autoArchiveDuration, id: threadId } = thread

  robot.logger.info(
    `New thread being monitored. ID: ${threadId}, AutoArchiveDuration: ${
      autoArchiveDuration ?? "Unknown"
    }`,
  )

  const channelMetadata = getThreadMetadata(robot.brain, thread) ?? {
    sync: true,
  }

  if (
    channelMetadata.sync &&
    messageTimestamp - (thread.createdTimestamp ?? 0) >
      MAX_HEURISTIC_SYNC_THREAD_DURATION
  ) {
    robot.logger.info("Marking thread", threadId, "as async")
    channelMetadata.sync = false
    updateThreadMetadata(robot.brain, thread, channelMetadata)
  }
}

async function updateThreadStatusFromAction(
  interaction: Interaction,
  robot: Robot,
): Promise<void> {
  if (interaction.isButton() && interaction.customId in threadActions) {
    const { channel: thread, customId: interactionId } = interaction

    robot.logger.info("New channel decision interaction", interactionId)

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
    getThreadMetadata(robot.brain, updatedThread) !== undefined
  ) {
    // Clear metadata for an archived thread.
    updateThreadMetadata(robot.brain, updatedThread, undefined)
  }

  // Force sync to false for an unarchived thread that was updated.
  if (
    oldThread.archived === true &&
    updatedThread.archived === false &&
    getThreadMetadata(robot.brain, updatedThread)?.sync !== false
  ) {
    updateThreadMetadata(robot.brain, updatedThread, { sync: false })
  }
}

async function checkThreadStatus(
  robot: Robot,
  discordClient: Client,
): Promise<void> {
  const threadMetadataByThreadId = getAllThreadMetadata(robot.brain)

  Object.entries(threadMetadataByThreadId)
    .filter(([, metadata]) => metadata?.sync === false)
    .forEach(async ([threadId]) => {
      const thread = discordClient.channels.cache.get(threadId)

      if (!thread?.isThread()) {
        robot.logger.error(
          `Error looking up thread with id ${threadId} in the client cache; skipping archive status check.`,
        )
        return
      }

      const lastMessage =
        thread.lastMessage ??
        (thread.lastMessageId !== null
          ? await thread.messages.fetch(thread.lastMessageId)
          : undefined)
      // About a day before the thread auto-archives, issue a warning that it will
      // be archived and ask for follow up, then set the thread to auto-archive
      // after a day.
      // Calculate the last activity timestamp (use thread creation as fallback)
      const lastActivityTimestamp =
        lastMessage?.createdTimestamp ?? thread.createdTimestamp ?? 0

      const autoArchiveDuration = thread.autoArchiveDuration as
        | ThreadAutoArchiveDuration
        | undefined

      if (!autoArchiveDuration) {
        robot.logger.info(
          `Thread ${threadId} has no valid autoArchiveDuration; skipping archive check.`,
        )
        return
      }

      // Let's be sure to calculate the exact archive time based on last activity
      const autoArchiveTime =
        lastActivityTimestamp + autoArchiveDuration * MINUTE

      const currentTime = Date.now()

      // We can then archive the thread if the expiry time has been reached or passed
      if (autoArchiveTime - currentTime <= 0) {
        const warningKey = `thread-warning:${threadId}`
        const warningMessageId = robot.brain.get(warningKey)

        if (warningMessageId) {
          try {
            const warningMessage = await thread.messages.fetch(warningMessageId)
            // this will edit the original message to indicate the thread has been archived
            await warningMessage.edit({
              content:
                "This thread is now archived as the auto-archive duration has been reached.",
              components: [],
            })
          } catch (error) {
            robot.logger.error(
              `Failed to edit the warning message for thread ${threadId}: ${error}`,
            )
          }
        }

        await thread.setArchived(true)
        robot.logger.info(
          `Archived thread ${threadId} as the auto-archive time has been reached.`,
        )
        return
      }

      // Then check if the thread is within the warning window
      if (
        autoArchiveTime - currentTime <= 24 * HOUR &&
        autoArchiveTime - currentTime > 0
      ) {
        const autoArchiveTimestamp = Math.floor(autoArchiveTime / 1000)

        // + thread metadata for an existing warning message ID
        const warningKey = `thread-warning:${threadId}`
        if (robot.brain.get(warningKey)) {
          robot.logger.info(
            `Thread ${threadId} already has a warning message. Skipping warning.`,
          )
          return
        }

        // Send warning message to the thread with actions
        const warningMessage = await thread.send({
          content: `This thread will be auto-archived on <t:${autoArchiveTimestamp}:F> (<t:${autoArchiveTimestamp}:R>) without further updates; what's next?`,
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
        // Let's add back setting the thread autoArchive to 24hr after the message is sent
        await thread.setAutoArchiveDuration(AUTO_ARCHIVE_WARNING_LEAD_MINUTES)
        // Use robot brain to store the warning event data
        robot.brain.set(warningKey, warningMessage.id)
        robot.logger.info(
          `Sent auto-archive warning for thread ${threadId}. Message ID: ${
            warningMessage.id
          }, Auto-archive time: ${new Date(autoArchiveTime).toISOString()}`,
        )
      } else {
        robot.logger.info(
          `Thread ${threadId} is not within the warning window. Current time: ${new Date(
            currentTime,
          ).toISOString()}, Auto-archive time: ${new Date(
            autoArchiveTime,
          ).toISOString()}, Time remaining: ${
            (autoArchiveTime - currentTime) / (60 * 60 * 1000)
          } hours`,
        )
      }
      // FIXME Force thread archiving once we hit the auto-archive threshold,
      // FIXME as Discord no longer _actually_ auto-archives, instead
      // FIXME preferring to hide the thread from the sidebar but keep it
      // FIXME unarchived.
      // FIXME
      // FIXME See: https://github.com/discord/discord-api-docs/commit/7c4c4976be4c0396f1feef8def24c0e86927e3a4 .
      // FIXME
      // FIXME > The auto_archive_duration field previously controlled how long
      // FIXME > a thread could stay active, but is now repurposed to control how long
      // FIXME > the thread stays in the channel list.
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
