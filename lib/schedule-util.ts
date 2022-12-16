// Description:
//   A collection of helper functions for creating scheduled tasks with hubot in flowdock
//
// Dependencies:
//   "cron-parser"   : "~1.0.1",
//   "cronstrue"     : "^1.68.0"
//   "moment"        : "^2.24.0",
//   "node-schedule" : "~1.0.0",
//
// Configuration:
//   HUBOT_SCHEDULE_DEBUG - set "1" for debug
//   HUBOT_SCHEDULE_DONT_RECEIVE - set "1" if you don't want hubot to be processed by scheduled message
//   HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL - set "1" if you want to deny scheduling from other rooms
//   HUBOT_SCHEDULE_LIST_REPLACE_TEXT - set JSON object like '{"@":"[at]"}' to configure text replacement used when listing scheduled messages
//
// Author:
//   kb0rg
//
//   Inspired by, borrowed (and heavily modified) from the original code at
//   https://github.com/matsukaz/hubot-schedule
//   by matsukaz <matsukaz@gmail.com>

// configuration settings

import * as moment from "moment"
import * as cronstrue from "cronstrue"
import * as cronParser from "cron-parser"
import * as hubot from "hubot"

import {
  getRoomInfoFromIdOrName,
  getRoomNameFromId,
  encodeThreadId,
} from "./adapter-util"
import CONFIG, { RECURRING_JOB_STORAGE_KEY } from "./schedule-config"
import {
  MessageMetadata,
  ScheduledJob,
  ScheduledJobMap,
} from "./scheduled-jobs"

function urlFor(roomId: string, serverName: string, eventId: string): string {
  return `https://matrix.to/#/${roomId}/${eventId}?via=${serverName}`
}

function isCronPattern(pattern: string | Date) {
  if (pattern instanceof Date) {
    return false
  }
  const { errors } = cronParser.parseString(pattern)
  return !Object.keys(errors).length
}

export function updateJobInBrain(
  robotBrain: hubot.Brain<hubot.Adapter>,
  storageKey: string,
  job: ScheduledJob,
): ReturnType<ScheduledJob["serialize"]> {
  const serializedJob = job.serialize()

  const updatedJobs = {
    ...robotBrain.get(storageKey),
    [job.id]: serializedJob,
  }

  robotBrain.set(storageKey, updatedJobs)
  return updatedJobs
}

// TODO: pull formatters back into script, or out to a different lib
function formatJobForMessage(
  robotAdapter: hubot.Adapter,
  jobPattern: string,
  isCron: boolean,
  jobId: string,
  jobMessage: string,
  jobRoom: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
): string {
  let text = ""
  let roomDisplayText = ""
  let patternParsed = ""
  let messageParsed = ""
  let jobRoomDisplayName = ""

  if (isCron) {
    patternParsed = cronstrue.toString(jobPattern)
  } else {
    patternParsed = moment(jobPattern).format("llll Z")
  }

  jobRoomDisplayName = jobRoom
    ? getRoomNameFromId(robotAdapter, jobRoom) || jobRoom
    : "Private Message"
  roomDisplayText = `(to ${jobRoomDisplayName})`

  if (metadata && jobRoom && remindInThread) {
    const jobFlow = getRoomInfoFromIdOrName(robotAdapter, jobRoom)
    if (jobFlow) {
      const encodedId = encodeThreadId(metadata.threadId ?? metadata.messageId)
      const reminderURL = urlFor(jobRoom, "thesis.co", encodedId)

      roomDisplayText = `(to [thread in ${jobRoomDisplayName}](${reminderURL}))`
    }
  }

  if (jobMessage.length) {
    messageParsed = jobMessage
    // Ignore for expediency.
    // eslint-disable-next-line no-restricted-syntax
    for (const orgText in CONFIG.list.replaceText) {
      if (
        Object.prototype.hasOwnProperty.call(CONFIG.list.replaceText, orgText)
      ) {
        const replacedText = CONFIG.list.replaceText[orgText]
        messageParsed = messageParsed.replace(
          new RegExp(`${orgText}`, "g"),
          replacedText,
        )
      }
    }
  }

  text += `**${patternParsed}** (id: ${jobId}) ${roomDisplayText}:\n>${messageParsed}\n\n`

  return text
}

export function logSerializedJobDetails(
  logger: hubot.Log,
  serializedJob: ReturnType<ScheduledJob["serialize"]>,
  messagePrefix: string,
  jobId: string,
) {
  const [pattern, user, , metadata, remindInThread] = serializedJob
  logger.debug(
    `${messagePrefix} (${jobId}): pattern: ${pattern}, user: %o, message: (message redacted for privacy), metadata: %o, remindInThread: ${remindInThread}`,
    user,
    metadata,
  )
}

function isRestrictedRoom(
  targetRoom: string,
  msg: hubot.Response<hubot.Adapter> | string,
) {
  if (CONFIG.denyExternalControl === "1") {
    if (typeof msg !== "string" && msg.message.user.room !== targetRoom) {
      return true
    }
  }
  return false
}

const isBlank = (s: string | undefined | null) => !(s ? s.trim() : undefined)

/**
 * Given an object containing scheduled jobs currently in memory, an array of
 * room ids, and optionally a usedId, returns:
 * an array containing two arrays: the datetime jobs and the cron jobs
 * scheduled for the given rooms, and visible to the given user.
 */
function getScheduledJobList(
  jobsInMemory: ScheduledJobMap,
  rooms: string[],
  userIdForDMs: string | null = null,
) {
  // split jobs into date and cron pattern jobs
  const dateJobs: ScheduledJob[] = []
  const cronJobs: ScheduledJob[] = []

  Object.keys(jobsInMemory).forEach((id) => {
    const job = jobsInMemory[id]

    if (rooms.includes(job.user.room as string)) {
      // Exclude DM from list unless job's user matches specified user.
      if (
        typeof job.user.room === "undefined" &&
        job.user.id !== userIdForDMs
      ) {
        return
      }
      if (!isCronPattern(job.pattern)) {
        dateJobs.push(job)
      } else {
        cronJobs.push(job)
      }
    }
  })

  return [dateJobs, cronJobs]
}

function sortJobsByDate(jobs: ScheduledJob[]) {
  jobs.sort(
    (a, b) => new Date(a.pattern).getTime() - new Date(b.pattern).getTime(),
  )

  return jobs
}

function formatJobsForListMessage(
  robotAdapter: hubot.Adapter,
  jobs: ScheduledJob[],
  isCron: boolean,
) {
  let output = ""

  if (!isCron) {
    // eslint-disable-next-line no-param-reassign
    jobs = sortJobsByDate(jobs)
  }
  jobs.forEach((job) => {
    output += formatJobForMessage(
      robotAdapter,
      job.pattern,
      isCron,
      job.id,
      job.message,
      job.user.room as string,
      job.metadata,
      job.remindInThread,
    )
  })
  return output
}

export {
  CONFIG,
  RECURRING_JOB_STORAGE_KEY,
  isRestrictedRoom,
  isBlank,
  isCronPattern,
  getScheduledJobList,
  formatJobForMessage,
  formatJobsForListMessage,
  urlFor,
}
