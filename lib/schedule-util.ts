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
// @ts-ignore No definitions for now.
import scheduler from "node-schedule"
import * as cronParser from "cron-parser"
import cronstrue from "cronstrue"
import * as hubot from "hubot"
import { Robot } from "hubot"
const { TextMessage } = hubot
import * as util from "util"
import * as flowdock from "../lib/flowdock"

import {
  getRoomInfoFromIdOrName,
  getRoomNameFromId,
  encodeThreadId,
} from "../lib/flowdock-util"

export type ScheduledJob = Job

export type ScheduledJobMap = {
  [jobId: string]: ScheduledJob
}

export type JobUser = Pick<hubot.User, "id" | "name" | "room">

export type MessageMetadata = {
  thread_id?: string
  message_id?: string
  lastUrl?: string
}
const CONFIG = {
  debug: process.env.HUBOT_SCHEDULE_DEBUG,
  dontReceive: process.env.HUBOT_SCHEDULE_DONT_RECEIVE,
  denyExternalControl: process.env.HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL,
  list: {
    replaceText: JSON.parse(
      process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT
        ? process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT
        : '{"(@@?)":"[$1]","```":"\\n```\\n","#":"[#]","\\n":"\\n>"}',
    ),
  },
}

const JOB_MAX_COUNT = 10000
const RECURRING_JOB_STORAGE_KEY = "hubot_schedule"

function createScheduledJob(
  robot: Robot<any>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  user: JobUser,
  room: string,
  pattern: string,
  message: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
) {
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
    if (job) {
      logSerializedJobDetails(
        robot.logger,
        job,
        "New job created",
        id.toString(),
      )
      return `Schedule created:\n${formattedJob}`
    }
  } catch (err: any) {
    robot.logger.error(err)
    return `There was an issue trying to create this schedule/ reminder: ${err.message}.`
  }
}

const TEMPLATE_STRING_DISPATCHER: {
  [name: string]: (
    message: string,
    robotBrain: hubot.Brain<any>,
    runningJob: ScheduledJob | {},
  ) => string
} = {
  test: test,
  "last-url": lastUrl,
}

// This is a temporary function to test the template string behavior.
// It takes a string, coverts it to an int, and returns its square.
function test(inputString: string): string {
  let inputValue = parseInt(inputString)
  if (isNaN(inputValue)) {
    throw new Error(
      `Could not complete test function because \"${inputString}\" does not convert to an integer.`,
    )
  }
  return (inputValue * inputValue).toString()
}

/**
 * Given a string (either "self" or the job id of another scheduled job), a
 * robot brain, and the currently running job object, returns:
 * - the url of the posted message for the previous invocation of the job
 * specified in the input string,
 * or
 * - "(last url not found)" if the job exists but it does not have a saved
 * lastUrl value.
 *
 * Throws an error if the input string is a job id, and the corresponding job
 * is not found in the robot brain.
 */
function lastUrl(
  inputString: string,
  robotBrain: hubot.Brain<any>,
  runningJob: ScheduledJob | {},
): string {
  let ret

  if (inputString == "self") {
    ret = "metadata" in runningJob ? runningJob.metadata.lastUrl : undefined
  } else {
    let jobId = inputString

    // This feature is only enabled for cron jobs, so we can hard-code the storage key here
    let serializedJob = robotBrain.get(RECURRING_JOB_STORAGE_KEY)[jobId]
    if (!serializedJob) {
      throw new Error(`${jobId}: Scheduled job not found.`)
    }
    ret = serializedJob[3] && serializedJob[3].lastUrl
  }
  return ret || "(last url not found)"
}

/**
 * Given a message string from a scheduled job, returns:
 * A message that should be displayed to the user.
 */
function processTemplateString(
  message: string,
  robotBrain: hubot.Brain<any>,
  runningJob: ScheduledJob | {},
): string {
  let templateStringMatch = message.match(/\{\{(.*?):(.*?)\}\}/i)
  if (!templateStringMatch) {
    return message
  }
  let [templateString, templateStringCommand, templateStringValue] =
    templateStringMatch
  let templateStringFormatted = ""

  try {
    let allowedCommand =
      TEMPLATE_STRING_DISPATCHER[templateStringCommand.trim()]

    if (!allowedCommand) {
      throw new Error(
        `\"${templateStringCommand}\" is not a valid templated command.`,
      )
    }
    templateStringFormatted = allowedCommand(
      templateStringValue.trim(),
      robotBrain,
      runningJob,
    )
  } catch (error: any) {
    throw new Error(
      `Could not process template string in message: ${error.message}`,
    )
  }

  return processTemplateString(
    message.replace(templateString, templateStringFormatted),
    robotBrain,
    runningJob,
  )
}

function scheduleNewJob(
  robot: hubot.Robot<any>,
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
    if (!isNaN(date)) {
      if (date < Date.now()) {
        throw new Error(`\"${pattern}\" has already passed.`)
      }
      revisedPattern = new Date(pattern).toString()
      cb = function () {
        delete jobsInMemory[id]
        return delete robot.brain.get(storageKey)[id]
      }
    } else {
      // these errors should be handled in the scripts, this is a fallback
      throw new Error(`\"${pattern}\" is an invalid pattern.`)
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

function startScheduledJob(
  robot: hubot.Robot<any>,
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
  jobsInMemory[id] = job
  return (robot.brain.get(storageKey)[id] = job.serialize())
}

function updateJobInBrain(
  robotBrain: hubot.Brain<any>,
  storageKey: string,
  job: Job,
): string {
  let serializedJob = job.serialize()
  return (robotBrain.get(storageKey)[job.id] = serializedJob)
}

function updateScheduledJob(
  robot: hubot.Robot<any>,
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

  let serializedJob = updateJobInBrain(robot.brain, storageKey, job)
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
  robot: hubot.Robot<any>,
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
  delete jobsInMemory[id]
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

function syncSchedules(
  robot: hubot.Robot<any>,
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
    const job = jobsInMemory[id]
    scheduleFromBrain(
      robot,
      jobsInMemory,
      storageKey,
      id,
      job.pattern,
      job.user,
      job.message,
      job.metadata,
    )

    logSerializedJobDetails(
      robot.logger,
      job.serialize(),
      "Synced job FROM brain",
      id,
    )
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

function scheduleFromBrain(
  robot: hubot.Robot<any>,
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
  } catch (error: any) {
    if (CONFIG.debug === "1") {
      robot.logger.error(
        `${id}: Failed to schedule from brain. [${error.message}]`,
      )
    }
    delete robot.brain.get(storageKey)[id]
  }
}

function storeScheduleInBrain(
  robot: hubot.Robot<any>,
  storageKey: string,
  id: string,
  job: Job,
) {
  robot.brain.get(storageKey)[id] = job.serialize()

  if (CONFIG.debug === "1") {
    robot.logger.info(`${id}: Schedule stored in brain asynchronously.`)
  }
}

function missingKeys<A extends ScheduledJobMap, B extends ScheduledJobMap>(
  obj1: A,
  obj2: B,
): string[] {
  const diff: string[] = []
  for (let id in obj1) {
    if (!(id in obj2)) {
      diff.push(id)
    }
  }
  return diff
}

function isCronPattern(pattern: string | Date) {
  if (pattern instanceof Date) {
    return false
  } else {
    const { errors } = cronParser.parseString(pattern)
    return !Object.keys(errors).length
  }
}

var isBlank = (s: string | undefined | null) => !(s ? s.trim() : undefined)

function isRestrictedRoom(
  targetRoom: string,
  msg: hubot.Response<any> | string,
) {
  if (CONFIG.denyExternalControl === "1") {
    if (typeof msg !== "string" && msg.message.user.room !== targetRoom) {
      return true
    }
  }
  return false
}

/**
 * Given an object containing scheduled jobs currently in memory, an array of
 * room ids, and optionally a usedId, returns:
 * an array containing two arrays: the datetime jobs and the cron jobs
 * scheduled for the given rooms, and visible to the given user.
 */
function getScheduledJobList(
  jobsInMemory: ScheduledJobMap,
  rooms: string[],
  userIdForDMs = null,
) {
  // split jobs into date and cron pattern jobs
  const dateJobs = []
  const cronJobs = []

  for (let id in jobsInMemory) {
    let job = jobsInMemory[id]

    if (rooms.includes(job.user.room as string)) {
      // Exclude DM from list unless job's user matches specified user.
      if (typeof job.user.room === "undefined" && job.user.id != userIdForDMs) {
        continue
      }
      if (!isCronPattern(job.pattern)) {
        dateJobs.push(job)
      } else {
        cronJobs.push(job)
      }
    }
  }

  return [dateJobs, cronJobs]
}

// TODO: pull formatters back into script, or out to a different lib
function formatJobForMessage(
  robotAdapter: any,
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
    let jobFlow = getRoomInfoFromIdOrName(robotAdapter, jobRoom)
    if (jobFlow) {
      let jobRoomPath = robotAdapter.flowPath(jobFlow)
      let encodedId = encodeThreadId(metadata.message_id || metadata.thread_id)

      let reminderURL = metadata.thread_id
        ? flowdock.URLs.thread
        : flowdock.URLs.messageDetail

      reminderURL = reminderURL
        .replace(/{flowPath}/, jobRoomPath)
        .replace(/{messageId}|{threadId}/, encodedId)

      roomDisplayText = `(to [thread in ${jobRoomDisplayName}](${reminderURL}))`
    }
  }

  if (!!jobMessage.length) {
    messageParsed = jobMessage
    for (let orgText in CONFIG.list.replaceText) {
      const replacedText = CONFIG.list.replaceText[orgText]
      messageParsed = messageParsed.replace(
        new RegExp(`${orgText}`, "g"),
        replacedText,
      )
    }
  }

  text += `**${patternParsed}** (id: ${jobId}) ${roomDisplayText}:\n>${messageParsed}\n\n`

  return text
}

function sortJobsByDate(jobs: Job[]) {
  jobs.sort((a, b) => {
    return new Date(a.pattern).getTime() - new Date(b.pattern).getTime()
  })

  return jobs
}

function formatJobsForListMessage(
  robotAdapter: any,
  jobs: Job[],
  isCron: boolean,
) {
  let output = ""

  if (!isCron) {
    jobs = sortJobsByDate(jobs)
  }
  for (let job of jobs) {
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
  }
  return output
}

function logSerializedJobDetails(
  logger: any,
  serializedJob: string,
  messagePrefix: string,
  jobId: string,
) {
  let [pattern, user, , metadata, remindInThread] = serializedJob
  logger.debug(
    `${messagePrefix} (${jobId}): pattern: ${pattern}, user: %o, message: (message redacted for privacy), metadata: %o, remindInThread: ${remindInThread}`,
    user,
    metadata,
  )
}

class Job {
  public user: JobUser
  public job: any

  constructor(
    public id: string,
    public pattern: string,
    user: JobUser,
    public room: string,
    public message: string,
    private cb: (() => void) | undefined,
    public metadata: MessageMetadata,
    public remindInThread = false,
  ) {
    this.user = {
      room: room || user.room,
      name: user.name,
      id: user.id,
    }
  }

  start(robot: hubot.Robot<any>) {
    return (this.job = scheduler.scheduleJob(this.pattern, () => {
      const envelope = {
        user: this.user,
        room: this.user.room,
        metadata: (this.remindInThread && this.metadata) || {},
      }

      let processedMessage = ""
      try {
        processedMessage = processTemplateString(
          this.message,
          robot.brain,
          this,
        )
      } catch (error) {
        robot.logger.error(
          `Problem processing message at job start: ${require("util").inspect(
            error,
          )}`,
        )
        // Do not throw error since this will fail invisibly to the user. Return unprocessed message.
        // However, we should not hit this case since job creation will fail with an error.
        processedMessage = this.message
      }

      if (
        !isCronPattern(this.pattern) ||
        robot.adapter.name.toLowerCase() != "reload-flowdock" ||
        !this.user.room
      ) {
        // Send via adapter in the following cases:
        // - if the job is a DateTime, not recurring job (these get deleted after sending, so there is no way to look up their lastUrl).
        // - if not using the Flowdock adapter (to enable local testing and avoid API errors).
        // - if the job is in a private message (these have no thread_id).
        robot.adapter.send(envelope, processedMessage)

        if (CONFIG.dontReceive !== "1") {
          // Send message to the adapter, to allow hubot to process the message.
          // We handle this case in the postMessageCallback for all API-posted jobs.
          let messageObj = new TextMessage(
            new hubot.User(this.user.id, this.user),
            processedMessage,
            "",
          )
          // Datetime jobs created via `remind` retain thread_id in metadata.
          // @ts-expect-error Metadata is not properly reflected in Message type.
          messageObj.metadata = envelope.metadata
          robot.adapter.receive(messageObj)
        }
      } else {
        // Recurring jobs should post via API instead, so we can save thread id.
        postMessageAndSaveThreadId(robot, this, processedMessage)
      }

      return typeof this.cb === "function" ? this.cb() : undefined
    }))
  }

  cancel() {
    if (this.job) {
      scheduler.cancelJob(this.job)
    }
    return typeof this.cb === "function" ? this.cb() : undefined
  }

  serialize(): string {
    return JSON.stringify([
      this.pattern,
      this.user,
      this.message,
      this.metadata,
      this.remindInThread,
    ])
  }
}

function postMessageAndSaveThreadId(
  robot: hubot.Robot<any>,
  job: Job,
  messageText: string,
) {
  // This uses the Flowdock API to post instead of robot.send, so that we can
  // capture the thread id of the posted message.

  let postParams = {
    event: "message",
    content: messageText,
    flow: job.user.room,
  }

  let extraHeader = { "X-flowdock-wait-for-message": true }

  robot.adapter.bot.post(
    "/messages",
    postParams,
    extraHeader,
    postMessageCallback(robot, job, messageText),
  )
}

function postMessageCallback(
  robot: hubot.Robot<any>,
  runningJob: Job,
  messageText: string,
) {
  return function (err: any, res: any, body: any) {
    let logMessage = ""
    let lastUrl, serializedJob
    let baseURL = "https://www.flowdock.com/app/{flowPath}/threads/{messageId}"
    let threadId = ""
    if (err) {
      // Send job via adapter if there's an error posting via API. Since we
      // won't get back a thread_id to save into the lastUrl, we clear the
      // lastUrl param currently set on the recurring job.

      robot.logger.error(
        `Problem posting scheduled job message via Flowdock API: ${util.inspect(
          err,
          { depth: 0 },
        )}`,
      )

      const messageEnvelope = {
        user: runningJob.user,
        room: runningJob.user.room,
        // We exclude the job's metadata here: cron jobs are not remindInThread.
      }

      logMessage =
        "Updated job after falling back to robot send, no thread_id available to save in last url."

      robot.adapter.send(messageEnvelope, messageText)
    } else if (res && res.flow && res.thread_id) {
      // Build the url.
      let lastPostedFlow = getRoomInfoFromIdOrName(robot.adapter, res.flow)
      if (lastPostedFlow) {
        threadId = res.thread_id // We may need this from `robot.adapter.receive()`
        let lastPostedFlowPath = robot.adapter.flowPath(lastPostedFlow)
        let encodedId = encodeThreadId(threadId)
        lastUrl = baseURL
          .replace(/{flowPath}/, lastPostedFlowPath)
          .replace(/{messageId}|{threadId}/, encodedId)

        logMessage = "Updated job's last url after posting latest occurrence"
      }
    } else {
      // Something went wrong getting a thread_id back from the API for the job
      // that just fired, even though the job's message posted without error.
      // Clear the job's lastUrl param.

      robot.logger.info(
        `Could not get thread_id for schedule job # ${runningJob.id}`,
        `FLowdock API response: ${util.inspect(body, { depth: 0 })}`,
      )
      logMessage =
        "Updated job after posting via API, but no thread_id available to save in last url."
    }
    if (CONFIG.dontReceive !== "1") {
      // Send message to the adapter, to allow hubot to process the message.
      let messageObj = new TextMessage(
        new hubot.User(runningJob.user.id, runningJob.user),
        messageText,
        "",
      )
      // If we got a threadId from the API, include it as metadata
      // @ts-expect-error Metadata is not properly reflected in Message type.
      messageObj.metadata = { thread_id: threadId }
      robot.adapter.receive(messageObj)
    }

    // Update the job in memory, and ensure metadata exists
    if (!!runningJob.metadata) {
      runningJob.metadata.lastUrl = lastUrl
    } else {
      runningJob.metadata = { lastUrl: lastUrl }
    }

    // Update the job in brain and log the update.
    serializedJob = updateJobInBrain(
      robot.brain,
      RECURRING_JOB_STORAGE_KEY,
      runningJob,
    )
    logSerializedJobDetails(
      robot.logger,
      serializedJob,
      logMessage,
      runningJob.id,
    )
  }
}

module.exports = {
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
