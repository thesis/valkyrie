// Description:
//    A collection of helper functions for creating scheduled tasks with hubot in flowdock
//
// Dependencies:
//   "node-schedule" : "~1.0.0",
//   "cron-parser"   : "~1.0.1",
//   "cronstrue"     : "^1.68.0"
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

const scheduler = require("node-schedule")
const cronParser = require("cron-parser")
const cronstrue = require("cronstrue")
const moment = require("moment") // TODO: remove if unused
const { TextMessage } = require("hubot")

const { getRoomNameFromId } = require("../lib/flowdock-util")

function createScheduledJob(robot, msg, room, pattern, message) {
  let id
  if (JOB_MAX_COUNT <= Object.keys(JOBS).length) {
    return msg.send("Too many scheduled messages")
  }

  while (id == null || JOBS[id]) {
    id = Math.floor(Math.random() * JOB_MAX_COUNT)
  }
  try {
    const job = scheduleNewJob(
      robot,
      id,
      pattern,
      msg.message.user,
      room,
      message,
    )
    if (job) {
      formattedJob = formatJobListItem(
        robot,
        pattern,
        isCronPattern(pattern),
        id,
        message,
        room,
        room ? true : false,
      )
      return msg.send(`Schedule created:\n${formattedJob}`)
    } else {
      return msg.send(`\
\"${pattern}\" is an invalid pattern.
See http://crontab.org/ for cron-style format pattern.
See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for datetime-based format pattern.\
`)
    }
  } catch (error) {
    return msg.send(error.message)
  }
}

function scheduleNewJob(robot, id, pattern, user, room, message) {
  if (isCronPattern(pattern)) {
    return createCronJob(robot, id, pattern, user, room, message)
  }

  const date = Date.parse(pattern)
  if (!isNaN(date)) {
    if (date < Date.now()) {
      throw new Error(`\"${pattern}\" has already passed`)
    }
    return createDatetimeJob(robot, id, pattern, user, room, message)
  }
}

var createCronJob = (robot, id, pattern, user, room, message) =>
  startScheduledJob(robot, id, pattern, user, room, message)

var createDatetimeJob = (robot, id, pattern, user, room, message) =>
  startScheduledJob(
    robot,
    id,
    new Date(pattern),
    user,
    room,
    message,
    function() {
      delete JOBS[id]
      return delete robot.brain.get(STORE_KEY)[id]
    },
  )

function startScheduledJob(robot, id, pattern, user, room, message, cb) {
  if (!room) {
    // if a targetRoom isn't specified, send to current room
    room = user.room
  }
  const job = new Job(id, pattern, user, room, message, cb)
  job.start(robot)
  JOBS[id] = job
  return (robot.brain.get(STORE_KEY)[id] = job.serialize())
}

function updateScheduledJob(robot, msg, id, message) {
  const job = JOBS[id]
  if (!job) {
    return msg.send(`Schedule ${id} not found`)
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return msg.send(
      `Updating schedule for the ${getRoomNameFromId(
        robot.adapter,
        job.user.room,
      ) || job.user.room} flow is restricted`,
    )
  }

  job.message = message
  robot.brain.get(STORE_KEY)[id] = job.serialize()
  formattedJob = formatJobListItem(
    robot,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.room,
    job.room ? true : false,
  )
  return msg.send(`Schedule message updated:\n${formattedJob}`)
}

function cancelScheduledJob(robot, msg, id) {
  const job = JOBS[id]
  if (!job) {
    return msg.send(`${id}: Schedule not found`)
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return msg.send(
      `Canceling schedule for the ${getRoomNameFromId(
        robot.adapter,
        job.user.room,
      ) || job.user.room} flow is restricted`,
    )
  }

  job.cancel()
  delete JOBS[id]
  delete robot.brain.get(STORE_KEY)[id]
  formattedJob = formatJobListItem(
    robot,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.room,
    job.room ? true : false,
  )
  return msg.send(`Schedule canceled:\n${formattedJob}`)
}

function syncSchedules(robot) {
  let id, job
  if (!robot.brain.get(STORE_KEY)) {
    robot.brain.set(STORE_KEY, {})
  }

  const nonCachedSchedules = difference(robot.brain.get(STORE_KEY), JOBS)
  for (id of Object.keys(nonCachedSchedules || {})) {
    job = nonCachedSchedules[id]
    scheduleFromBrain(robot, id, ...job)
  }

  const nonStoredSchedules = difference(JOBS, robot.brain.get(STORE_KEY))
  return (() => {
    const result = []
    for (id of Object.keys(nonStoredSchedules || {})) {
      job = nonStoredSchedules[id]
      result.push(storeScheduleInBrain(robot, id, job))
    }
    return result
  })()
}

function scheduleFromBrain(robot, id, pattern, user, message) {
  const envelope = {
    user,
    room: user.room,
  }
  try {
    scheduleNewJob(robot, id, pattern, user, user.room, message)
  } catch (error) {
    if (CONFIG.debug === "1") {
      robot.send(
        envelope,
        `${id}: Failed to schedule from brain. [${error.message}]`,
      )
    }
    return delete robot.brain.get(STORE_KEY)[id]
  }

  if (CONFIG.debug === "1") {
    return robot.send(envelope, `${id} scheduled from brain`)
  }
}

function storeScheduleInBrain(robot, id, job) {
  robot.brain.get(STORE_KEY)[id] = job.serialize()

  const envelope = {
    user: job.user,
    room: job.user.room,
  }
  if (CONFIG.debug === "1") {
    return robot.send(
      envelope,
      `${id}: Schedule stored in brain asynchronously`,
    )
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

const toTwoDigits = num => `0${num}`.slice(-2)

function formatDate(date) {
  let offset = -date.getTimezoneOffset()
  let sign = " GMT+"
  if (offset < 0) {
    offset = -offset
    sign = " GMT-"
  }
  return (
    [
      date.getFullYear(),
      toTwoDigits(date.getMonth() + 1),
      toTwoDigits(date.getDate()),
    ].join("-") +
    " " +
    date.toLocaleTimeString() +
    sign +
    toTwoDigits(offset / 60) +
    ":" +
    toTwoDigits(offset % 60)
  )
}

function formatJobListItem(
  robot,
  jobPattern,
  isCron,
  jobId,
  jobMessage,
  jobRoom,
  showRoom,
) {
  let text = ""
  let roomDisplayText = ""
  let patternParsed = ""
  let messageParsed = ""

  if (isCron) {
    patternParsed = cronstrue.toString(jobPattern)
  } else {
    patternParsed = formatDate(new Date(jobPattern))
  }

  if (showRoom) {
    roomDisplayText = `(to ${getRoomNameFromId(robot.adapter, jobRoom) ||
      jobRoom})`
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

  text += `**${jobId}: [ ${patternParsed} ]** ${roomDisplayText}:\n>${messageParsed}\n\n`
  return text
}

class Job {
  constructor(id, pattern, user, room, message, cb) {
    this.id = id
    this.pattern = pattern
    this.user = {
      room: room || user.room,
    }
    for (let k in user) {
      const v = user[k]
      if (["id", "team_id", "name"].includes(k)) {
        this.user[k] = v
      }
    } // copy only needed properties
    this.message = message
    this.cb = cb
    this.job
  }

  start(robot) {
    return (this.job = scheduler.scheduleJob(this.pattern, () => {
      const envelope = {
        user: this.user,
        room: this.user.room,
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
    return [this.pattern, this.user, this.message]
  }
}

module.exports = {
  CONFIG,
  syncSchedules,
  isRestrictedRoom,
  createScheduledJob,
  isBlank,
  isCronPattern,
  formatJobListItem,
  updateScheduledJob,
  cancelScheduledJob,
}
