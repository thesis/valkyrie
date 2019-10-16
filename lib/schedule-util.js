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

const moment = require("moment")
const scheduler = require("node-schedule")
const cronParser = require("cron-parser")
const cronstrue = require("cronstrue")
const { TextMessage } = require("hubot")

const flowdock = require("../lib/flowdock")
const {
  getRoomInfoFromIdOrName,
  getRoomNameFromId,
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
  threadId,
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
    const job = scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id,
      pattern,
      user,
      room,
      message,
      threadId,
      remindInThread,
    )
    if (job) {
      logSerializedJobDetails(robot.logger, job, "New job created", id)

      let roomId = job[1].room

      formattedJob = formatJobForMessage(
        robot.adapter,
        pattern,
        isCronPattern(pattern),
        id,
        message,
        roomId,
        threadId,
        remindInThread,
      )
      return `Schedule created:\n${formattedJob}`
    }
  } catch (err) {
    robot.logger.error(err)
    return `There was an issue trying to create this schedule/ reminder: ${err.message}.`
  }
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
  threadId,
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
    threadId,
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
  threadId,
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
    threadId,
    remindInThread,
  )
  job.start(robot)
  jobsInMemory[id] = job
  return (robot.brain.get(storageKey)[id] = job.serialize())
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

  let serializedJob = job.serialize()
  robot.brain.get(storageKey)[id] = serializedJob

  logSerializedJobDetails(robot.logger, serializedJob, "Updated job", id)

  formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room,
    job.threadId,
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
    job.threadId,
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

    logSerializedJobDetails(robot.logger, job, "Synced job FROM brain", id)
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

      logSerializedJobDetails(robot.logger, job, "Synced job TO brain", id)
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
  threadId,
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
      threadId,
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
 * room (ids? names?), and optionally a usedId, returns an array containing two
 * objects, the datetime jobs and the cron jobs scheduled for the given rooms
 * and visible to the given user.
 */
function getScheduledJobList(jobsInMemory, rooms, userIdForDMs = null) {
  // split jobs into date and cron pattern jobs
  const dateJobs = {}
  const cronJobs = {}

  for (let id in jobsInMemory) {
    let job = jobsInMemory[id]

    if (rooms.includes(job.user.room)) {
      // Exclude DM from list unless job's user matches specified user.
      if (typeof job.user.room === "undefined" && job.user.id != userIdForDMs) {
        continue
      }
      if (!isCronPattern(job.pattern)) {
        dateJobs[id] = job
      } else {
        cronJobs[id] = job
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
  jobThreadId,
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

  if (jobThreadId && jobRoom && remindInThread) {
    let jobFlow = getRoomInfoFromIdOrName(robotAdapter, jobRoom)
    if (jobFlow) {
      let jobRoomPath = robotAdapter.flowPath(jobFlow)
      let encodedThreadId = encodeURIComponent(jobThreadId).replace(/-/g, "%2D")
      roomDisplayText = `(to [thread in ${jobRoomDisplayName}](${flowdock.URLs.thread}))`
        .replace(/{flowPath}/, jobRoomPath)
        .replace(/{threadId}/, encodedThreadId)
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
  // sort by date in ascending order
  for (let id of Object.keys(jobs).sort(
    (a, b) => new Date(jobs[a].pattern) - new Date(jobs[b].pattern),
  ))
    return jobs
}

function formatJobsForListMessage(robotAdapter, jobs, isCron) {
  let output = ""

  if (!isCron) {
    jobs = sortJobsByDate(jobs)
  }
  for (let id in jobs) {
    let job = jobs[id]

    output += formatJobForMessage(
      robotAdapter,
      job.pattern,
      isCron,
      job.id,
      job.message,
      job.user.room,
      job.threadId,
      job.remindInThread,
    )
  }
  return output
}

function logSerializedJobDetails(logger, serializedJob, messagePrefix, jobId) {
  let [pattern, user, , threadId, remindInThread] = serializedJob
  logger.debug(
    `${messagePrefix} (${jobId}): pattern: ${pattern}, user: %o, message: (message redacted for privacy), threadId: ${threadId}, remindInThread: ${remindInThread}`,
    user,
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
    threadId,
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
    this.threadId = threadId
    this.remindInThread = remindInThread
    this.cb = cb
  }

  start(robot) {
    return (this.job = scheduler.scheduleJob(this.pattern, () => {
      const envelope = {
        user: this.user,
        room: this.user.room,
        metadata: { thread_id: (this.remindInThread && this.threadId) || null },
      }

      robot.send(envelope, this.message)
      if (CONFIG.dontReceive !== "1") {
        robot.adapter.receive(new TextMessage(this.user, this.message))
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
      this.threadId,
      this.remindInThread,
    ]
  }
}

module.exports = {
  CONFIG,
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
