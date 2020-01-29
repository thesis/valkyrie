// Description:
//    A collection of helper functions for creating scheduled tasks with hubot in flowdock
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
// configuration settings

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

const moment = require("moment")
const scheduler = require("node-schedule")
const cronParser = require("cron-parser")
const cronstrue = require("cronstrue")
const { TextMessage } = require("hubot")

const flowdock = require("../lib/flowdock")
const {
  getRoomInfoFromIdOrName,
  getRoomNameFromId,
  encodeThreadId,
  isRoomInviteOnly,
} = require("../lib/flowdock-util")

function createScheduledJob(
  robot,
  jobsInMemory,
  storageKey,
  user,
  room,
  pattern,
  message,
  metadata,
  remindInThread,
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

    formattedJob = formatJobForMessage(
      robot.adapter,
      pattern,
      isCronPattern(pattern),
      id,
      message,
      room,
      metadata,
      remindInThread,
    )

    const job = scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id,
      pattern,
      user,
      room,
      message,
      metadata,
      remindInThread,
    )
    if (job) {
      logSerializedJobDetails(robot.logger, job, "New job created", id)
      return `Schedule created:\n${formattedJob}`
    }
  } catch (err) {
    robot.logger.error(err)
    return `There was an issue trying to create this schedule/ reminder: ${err.message}.`
  }
}

const TEMPLATE_STRING_DISPATCHER = {
  test: test,
  "last-url": lastUrl,
}

// This is a temporary function to test the template string behavior.
// It takes a string, coverts it to an int, and returns its square.
function test(inputString) {
  let inputValue = parseInt(inputString)
  if (isNaN(inputValue)) {
    throw new Error(
      `Could not complete test function because \"${inputString}\" does not convert to an integer.`,
    )
  }
  return inputValue * inputValue
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
function lastUrl(inputString, robotBrain, runningJob) {
  let ret

  if (inputString == "self") {
    ret = runningJob.metadata ? runningJob.metadata.lastUrl : undefined
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
function processTemplateString(message, robotBrain, runningJob) {
  let templateStringMatch = message.match(/\{\{(.*):(.*)\}\}/i)
  if (!templateStringMatch) {
    return message
  }
  let [
    templateString,
    templateStringCommand,
    templateStringValue,
  ] = templateStringMatch
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
  } catch (error) {
    throw new Error(
      `Could not process template string in message: ${error.message}`,
    )
  }
  return message.replace(templateString, templateStringFormatted)
}

function scheduleNewJob(
  robot,
  jobsInMemory,
  storageKey,
  id,
  pattern,
  user,
  room,
  message,
  metadata,
  remindInThread,
) {
  let cb

  if (!isCronPattern(pattern)) {
    const date = Date.parse(pattern)
    if (!isNaN(date)) {
      if (date < Date.now()) {
        throw new Error(`\"${pattern}\" has already passed.`)
      }
      pattern = new Date(pattern)
      cb = function() {
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
    pattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread,
  )
}

function startScheduledJob(
  robot,
  jobsInMemory,
  storageKey,
  id,
  pattern,
  user,
  room,
  message,
  cb,
  metadata,
  remindInThread,
) {
  if (!room) {
    // if a targetRoom isn't specified, send to current room
    room = user.room
  }
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

function updateJobInBrain(robotBrain, storageKey, job) {
  let serializedJob = job.serialize()
  return (robotBrain.get(storageKey)[job.id] = serializedJob)
}

function updateScheduledJob(robot, jobsInMemory, storageKey, msg, id, message) {
  const job = jobsInMemory[id]
  if (!job) {
    return `Schedule ${id} not found.`
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return `Updating schedule for the ${getRoomNameFromId(
      robot.adapter,
      job.user.room,
    ) || job.user.room} flow is restricted.`
  }

  job.message = message

  let serializedJob = updateJobInBrain(robot.brain, storageKey, job)
  logSerializedJobDetails(robot.logger, serializedJob, "Updated job", id)

  formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule message updated:\n${formattedJob}`
}

function cancelScheduledJob(robot, jobsInMemory, storageKey, msg, id) {
  const job = jobsInMemory[id]
  if (!job) {
    return `${id}: Schedule not found.`
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return `Canceling schedule for the ${getRoomNameFromId(
      robot.adapter,
      job.user.room,
    ) || job.user.room} flow is restricted.`
  }

  job.cancel()
  delete jobsInMemory[id]
  delete robot.brain.get(storageKey)[id]

  logSerializedJobDetails(robot.logger, job.serialize(), "Cancelled job", id)

  formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule canceled:\n${formattedJob}`
}

function syncSchedules(robot, storageKey, jobsInMemory) {
  let id, job
  if (!robot.brain.get(storageKey)) {
    robot.brain.set(storageKey, {})
  }

  const nonCachedSchedules = difference(
    robot.brain.get(storageKey),
    jobsInMemory,
  )
  for (id of Object.keys(nonCachedSchedules || {})) {
    job = nonCachedSchedules[id]
    scheduleFromBrain(robot, jobsInMemory, storageKey, id, ...job)

    logSerializedJobDetails(
      robot.logger,
      nonCachedSchedules[id],
      "Synced job FROM brain",
      id,
    )
  }

  const nonStoredSchedules = difference(
    jobsInMemory,
    robot.brain.get(storageKey),
  )
  return (() => {
    const result = []
    for (id of Object.keys(nonStoredSchedules || {})) {
      job = nonStoredSchedules[id]
      result.push(storeScheduleInBrain(robot, storageKey, id, job))

      logSerializedJobDetails(
        robot.logger,
        job.serialize(),
        "Synced job TO brain",
        id,
      )
    }
    return result
  })()
}

function scheduleFromBrain(
  robot,
  jobsInMemory,
  storageKey,
  id,
  pattern,
  user,
  message,
  metadata,
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
      user.room,
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
        `${id}: Failed to schedule from brain. [${error.message}]`,
      )
    }
    delete robot.brain.get(storageKey)[id]
  }
}

function storeScheduleInBrain(robot, storageKey, id, job) {
  robot.brain.get(storageKey)[id] = job.serialize()

  if (CONFIG.debug === "1") {
    robot.logger.info(`${id}: Schedule stored in brain asynchronously.`)
  }
}

function difference(obj1, obj2) {
  if (obj1 == null) {
    obj1 = {}
  }
  if (obj2 == null) {
    obj2 = {}
  }
  const diff = {}
  for (let id in obj1) {
    const job = obj1[id]
    if (!(id in obj2)) {
      diff[id] = job
    }
  }
  return diff
}

function isCronPattern(pattern) {
  if (pattern instanceof Date) {
    return false
  } else {
    const { errors } = cronParser.parseString(pattern)
    return !Object.keys(errors).length
  }
}

var isBlank = s => !(s ? s.trim() : undefined)

function isRestrictedRoom(targetRoom, robot, msg) {
  if (CONFIG.denyExternalControl === "1") {
    if (msg.message.user.room !== targetRoom) {
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
function getScheduledJobList(jobsInMemory, rooms, userIdForDMs = null) {
  // split jobs into date and cron pattern jobs
  const dateJobs = []
  const cronJobs = []

  for (let id in jobsInMemory) {
    let job = jobsInMemory[id]

    if (rooms.includes(job.user.room)) {
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
  robotAdapter,
  jobPattern,
  isCron,
  jobId,
  jobMessage,
  jobRoom,
  metadata,
  remindInThread,
) {
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

function sortJobsByDate(jobs) {
  jobs.sort((a, b) => {
    return new Date(a.pattern) - new Date(b.pattern)
  })

  return jobs
}

function formatJobsForListMessage(robotAdapter, jobs, isCron) {
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
      job.user.room,
      job.metadata,
      job.remindInThread,
    )
  }
  return output
}

function logSerializedJobDetails(logger, serializedJob, messagePrefix, jobId) {
  let [pattern, user, , metadata, remindInThread] = serializedJob
  logger.debug(
    `${messagePrefix} (${jobId}): pattern: ${pattern}, user: %o, message: (message redacted for privacy), metadata: %o, remindInThread: ${remindInThread}`,
    user,
    metadata,
  )
}

class Job {
  constructor(
    id,
    pattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread = false,
  ) {
    this.id = id
    this.pattern = pattern
    this.user = {
      room: room || user.room,
      name: user.name,
      id: user.id,
    }
    this.message = message
    this.metadata = metadata
    this.remindInThread = remindInThread
    this.cb = cb
  }

  start(robot) {
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

      if (!isCronPattern(this.pattern)) {
        // Datetime/ one-off reminders can be sent via robot, we do not need to
        // capture any info from the API.
        robot.send(envelope, processedMessage)

        if (CONFIG.dontReceive !== "1") {
          // Send message to the adapter, to allow hubot to process the message.
          let messageObj = new TextMessage(this.user, processedMessage)
          // Datetime jobs created via `remind` retain thread_id in metadata.
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

  serialize() {
    return [
      this.pattern,
      this.user,
      this.message,
      this.metadata,
      this.remindInThread,
    ]
  }
}

function postMessageAndSaveThreadId(robot, job, messageText) {
  // This uses the Flowdock API to post instead of robot.send, so that we can
  // capture the thread id of the posted message.

  let postEndpoint = job.user.room
    ? "/messages"
    : "/private/{user_id}/messages".replace(/{user_id}/, job.user.id)

  let postParams = {
    event: "message",
    content: messageText,
  }

  if (!!job.user.room) {
    let moreParams = { flow: job.user.room }
    Object.assign(postParams, moreParams)
  }

  let extraHeader = { "X-flowdock-wait-for-message": true }

  robot.adapter.bot.post(
    postEndpoint,
    postParams,
    extraHeader,
    postMessageCallback(robot, job, messageText),
  )
}

function postMessageCallback(robot, runningJob, messageText) {
  return function(err, res, body) {
    let logMessage = ""
    let lastUrl, serializedJob
    let baseURL = "https://www.flowdock.com/app/{flowPath}/threads/{messageId}"
    let threadId = ""
    if (err) {
      // Send job via adapter if there's an error posting via API. Since we
      // won't get back a thread_id to save into the lastUrl, we clear the
      // lastUrl param currently set on the recurring job.

      robot.logger.error(
        `Problem posting scheduled job message via Flowdock API: %o`,
        err,
      )

      const messageEnvelope = {
        user: runningJob.user,
        room: runningJob.user.room,
        // We exclude the job's metadata here: cron jobs are not remindInThread.
      }

      logMessage =
        "Updated job after falling back to robot send, no thread_id available to save in last url."

      robot.send(messageEnvelope, messageText)
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
        `FLowdock API response: %o`,
        body,
      )
      logMessage =
        "Updated job after posting via API, but no thread_id available to save in last url."
    }
    if (CONFIG.dontReceive !== "1") {
      // Send message to the adapter, to allow hubot to process the message.
      let messageObj = new TextMessage(runningJob.user, messageText)
      // If we got a threadId from the API, include it as metadata
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
