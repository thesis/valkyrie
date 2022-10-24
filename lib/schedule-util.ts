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

import moment from "moment"
import cronstrue from "cronstrue"
import * as hubot from "hubot"
import { Robot } from "hubot"

import {
  getRoomInfoFromIdOrName,
  getRoomNameFromId,
  encodeThreadId,
} from "./adapter-util"
import Job, {
  JobUser,
  MessageMetadata,
  isCronPattern,
  urlFor,
  updateJobInBrain,
} from "./Job"
import CONFIG, { RECURRING_JOB_STORAGE_KEY } from "./schedule-config"
import { processTemplateString } from "./template-strings"

const JOB_MAX_COUNT = 10000

function missingKeys<A extends ScheduledJobMap, B extends ScheduledJobMap>(
  obj1: A,
  obj2: B,
): string[] {
  const diff: string[] = []
  Object.keys(obj1).forEach((id) => {
    if (!(id in obj2)) {
      diff.push(id)
    }
  })
  return diff
}

function storeScheduleInBrain(
  robot: hubot.Robot<hubot.Adapter>,
  storageKey: string,
  id: string,
  job: Job,
) {
  // eslint-disable-next-line no-param-reassign
  robot.brain.get(storageKey)[id] = job.serialize()

  if (CONFIG.debug === "1") {
    robot.logger.info(`${id}: Schedule stored in brain asynchronously.`)
  }
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

function startScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  room: string,
  message: string,
  cb: (() => void) | undefined,
  metadata: MessageMetadata,
  remindInThread: boolean,
) {
  // if a targetRoom isn't specified, send to current room
  // eslint-disable-next-line no-param-reassign
  room ??= user.room as string
  const job = new Job(
    id,
    pattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread,
  )
  job.start(robot)
  // eslint-disable-next-line no-param-reassign
  jobsInMemory[id] = job
  // eslint-disable-next-line no-param-reassign, no-return-assign
  return (robot.brain.get(storageKey)[id] = job.serialize())
}

function scheduleNewJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  room: string,
  message: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
) {
  let cb
  let revisedPattern = pattern

  if (!isCronPattern(pattern)) {
    const date = Date.parse(pattern)
    if (!Number.isNaN(date)) {
      if (date < Date.now()) {
        throw new Error(`"${pattern}" has already passed.`)
      }
      revisedPattern = new Date(pattern).toString()
      cb = function updateJobsInMemory() {
        // eslint-disable-next-line no-param-reassign
        delete jobsInMemory[id]
        // eslint-disable-next-line no-param-reassign
        return delete robot.brain.get(storageKey)[id]
      }
    } else {
      // these errors should be handled in the scripts, this is a fallback
      throw new Error(`"${pattern}" is an invalid pattern.`)
    }
  }

  return startScheduledJob(
    robot,
    jobsInMemory,
    storageKey,
    id,
    revisedPattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread,
  )
}

function logSerializedJobDetails(
  logger: any,
  serializedJob: ReturnType<Job["serialize"]>,
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

function createScheduledJob(
  robot: Robot,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  user: JobUser,
  room: string,
  pattern: string,
  message: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
): string {
  let id
  if (JOB_MAX_COUNT <= Object.keys(jobsInMemory).length) {
    return "Too many scheduled messages."
  }

  while (id == null || jobsInMemory[id]) {
    id = Math.floor(Math.random() * JOB_MAX_COUNT)
  }
  try {
    // Make sure template string, if present, is valid, but do not save return.
    // The job is not yet created at this point, so we pass an empty object.
    processTemplateString(message, robot.brain, {})

    const formattedJob = formatJobForMessage(
      robot.adapter,
      pattern,
      isCronPattern(pattern),
      id.toString(),
      message,
      room,
      metadata,
      remindInThread,
    )

    const job = scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id.toString(),
      pattern,
      user,
      room,
      message,
      metadata,
      remindInThread,
    )

    logSerializedJobDetails(robot.logger, job, "New job created", id.toString())
    return `Schedule created:\n${formattedJob}`
  } catch (err) {
    robot.logger.error(err)
    return `There was an issue trying to create this schedule/ reminder: ${
      err instanceof Error ? err.message : "(unknown error)"
    }.`
  }
}

function updateScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  msg: string,
  id: string,
  message: string,
) {
  const job = jobsInMemory[id]
  if (!job) {
    return `Schedule ${id} not found.`
  }

  if (isRestrictedRoom(job.user.room as string, msg)) {
    return `Updating schedule for the ${
      getRoomNameFromId(robot.adapter, job.user.room) || job.user.room
    } flow is restricted.`
  }

  job.message = message

  const serializedJob = updateJobInBrain(robot.brain, storageKey, job)
  logSerializedJobDetails(robot.logger, serializedJob, "Updated job", id)

  const formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room as string,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule message updated:\n${formattedJob}`
}

function cancelScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  msg: string,
  id: string,
) {
  const job = jobsInMemory[id]
  if (!job) {
    return `${id}: Schedule not found.`
  }

  if (isRestrictedRoom(job.user.room as string, msg)) {
    return `Canceling schedule for the ${
      getRoomNameFromId(robot.adapter, job.user.room) || job.user.room
    } flow is restricted.`
  }

  job.cancel()
  // eslint-disable-next-line no-param-reassign
  delete jobsInMemory[id]
  // eslint-disable-next-line no-param-reassign
  delete robot.brain.get(storageKey)[id]

  logSerializedJobDetails(robot.logger, job.serialize(), "Cancelled job", id)

  const formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room as string,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule canceled:\n${formattedJob}`
}

function scheduleFromBrain(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  message: string,
  metadata: MessageMetadata,
  remindInThread = false, // jobs missing this param are likely schedule cron jobs
) {
  try {
    scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id,
      pattern,
      user,
      user.room as string /* making some assumptions here */,
      message,
      metadata,
      remindInThread,
    )
    if (CONFIG.debug === "1") {
      robot.logger.info(`${id} scheduled from brain.`)
    }
  } catch (error) {
    if (CONFIG.debug === "1") {
      robot.logger.error(
        `${id}: Failed to schedule from brain. [${
          error instanceof Error ? error.message : "(unknown error)"
        }] [${pattern}] [${message}]`,
      )
    }
    // eslint-disable-next-line no-param-reassign
    delete robot.brain.get(storageKey)[id]
  }
}

function syncSchedules(
  robot: hubot.Robot<hubot.Adapter>,
  storageKey: string,
  jobsInMemory: ScheduledJobMap,
) {
  if (!robot.brain.get(storageKey)) {
    robot.brain.set(storageKey, {})
  }
  const nonCachedScheduleIds = missingKeys(
    robot.brain.get(storageKey),
    jobsInMemory,
  )
  nonCachedScheduleIds.forEach((id) => {
    const jobData = robot.brain.get(storageKey)[id] as ReturnType<
      Job["serialize"]
    >
    scheduleFromBrain(robot, jobsInMemory, storageKey, id, ...jobData)

    logSerializedJobDetails(robot.logger, jobData, "Synced job FROM brain", id)
  })

  const nonStoredScheduleIds = missingKeys(
    jobsInMemory,
    robot.brain.get(storageKey),
  )
  return (() => {
    const result: void[] = []

    nonStoredScheduleIds.forEach((id) => {
      const job = jobsInMemory[id]
      result.push(storeScheduleInBrain(robot, storageKey, id, job))

      logSerializedJobDetails(
        robot.logger,
        job.serialize(),
        "Synced job TO brain",
        id,
      )
    })

    return result
  })()
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
  const dateJobs: Job[] = []
  const cronJobs: Job[] = []

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

function sortJobsByDate(jobs: Job[]) {
  jobs.sort(
    (a, b) => new Date(a.pattern).getTime() - new Date(b.pattern).getTime(),
  )

  return jobs
}

function formatJobsForListMessage(
  robotAdapter: hubot.Adapter,
  jobs: Job[],
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
  syncSchedules,
  isRestrictedRoom,
  createScheduledJob,
  isBlank,
  isCronPattern,
  getScheduledJobList,
  formatJobsForListMessage,
  updateScheduledJob,
  cancelScheduledJob,
}
