// Description:
//   Schedule a reminder message in both cron-style and datetime-based format pattern
//   Modified for flowdock, and converted to JS
//
// Dependencies:
//   "node-schedule" : "~1.0.0",
//   "cron-parser"   : "~1.0.1",
//   "cronstrue"     : "^1.68.0"
//
// Configuration:
//   HUBOT_REMINDER_DEBUG - set "1" for debug
//   HUBOT_REMINDER_DONT_RECEIVE - set "1" if you don't want hubot to be processed by reminder message
//   HUBOT_REMINDER_DENY_EXTERNAL_CONTROL - set "1" if you want to deny scheduling from other rooms
//   HUBOT_REMINDER_LIST_REPLACE_TEXT - set JSON object like '{"@":"[at]"}' to configure text replacement used when listing scheduled messages
//
// Commands:
//   hubot remind "<day or date in English>" <message> - Schedule a reminder that runs on a specific date and time. "YYYY-MM-DDTHH:mm" for UTC, or "YYYY-MM-DDTHH:mm-HH:mm" to specify a timezone offset. See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for more on datetime pattern syntax.
//   hubot remind "every <day or date in English>" <message> - Schedule a reminder that runs recurrently. For the wizards only. See http://crontab.org/ for cron pattern syntax.
//   hubot remind <flow> "<datetime pattern>" <message> - Schedule a reminder to a specific flow that runs on a specific date and time.
//   hubot remind <flow> "<cron pattern>" <message> - Schedule a reminder to a specific flow that runs recurrently
//   hubot reminder [cancel|del|delete|remove] <id> - Cancel the reminder
//   hubot reminder [upd|update] <id> <message> - Update reminder message
//   hubot reminder list - List all scheduled reminders for current flow. NOTE all times are listed in UTC
//   hubot reminder list <flow> - List all scheduled reminders for specified flow. NOTE all times are listed in UTC
//   hubot reminder list all - List all scheduled reminders for any flows. NOTE all times are listed in UTC
//
// Author:
//   kb0rg
//   matsukaz <matsukaz@gmail.com>
//
// configuration settings
const config = {
  debug: process.env.HUBOT_REMINDER_DEBUG,
  dontReceive: process.env.HUBOT_REMINDER_DONT_RECEIVE,
  denyExternalControl: process.env.HUBOT_REMINDER_DENY_EXTERNAL_CONTROL,
  list: {
    replaceText: JSON.parse(
      process.env.HUBOT_REMINDER_LIST_REPLACE_TEXT
        ? process.env.HUBOT_REMINDER_LIST_REPLACE_TEXT
        : '{"(@@?)":"[$1]","```":"\\n```\\n","#":"[#]","\\n":"\\n>"}',
    ),
  },
}

const scheduler = require("node-schedule")
const cronParser = require("cron-parser")
const cronstrue = require("cronstrue")
const crontalk = require("crontalk")
const friendlyCron = require("friendly-cron")
const moment = require("moment")
const { TextMessage } = require("hubot")
const chrono = require("chrono-node")
const getCronString = require("@darkeyedevelopers/natural-cron.js")

const {
  getRoomIdFromName,
  getRoomNameFromId,
  robotIsInRoom,
} = require("../lib/flowdock-util")

const REMINDER_JOBS = {}
const JOB_MAX_COUNT = 10000
const REMINDER_KEY = "hubot_reminders"
const CRON_PATTERN_FORMAT = "MIN HOR DOM MON WEK"

module.exports = function(robot) {
  robot.brain.on("loaded", () => {
    return syncReminders(robot)
  })

  if (!robot.brain.get(REMINDER_KEY)) {
    robot.brain.set(REMINDER_KEY, {})
  }

  // TODO: clarify desired syntax, clean up pattern
  // any symbols we can use to help parse?
  // --> remind (me|@username) (in <flowname>) (when|how often) (what)
  robot.respond(/remind ([^"]*?)"(.*?)" ((?:.|\s)*)$/i, function(msg) {
    let isPrivate = false
    let targetRoom = msg.match[1] // optional name of room specified in msg
    let targetRoomId = null

    if (!isBlank(targetRoom)) {
      targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)

      if (isRestrictedRoom(targetRoomId, robot, msg)) {
        return msg.send(
          `Creating reminder for the ${targetRoom} flow is restricted`,
        )
      }

      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        return msg.send(
          `Can't create reminder for ${targetRoom}: I'm not in that flow, or there's a typo in the name`,
        )
      }
    } else {
      if (typeof msg.user.room === "undefined") {
        isPrivate = true
      }
    }
    // TODO: add isPrivate here, or lower in the chain?
    console.log(
      `->->->->->->-> about to CreateReminderJob -> targetRoomId: ${targetRoomId} ------- targetRoom: ${targetRoom}`,
    )
    return createReminderJob(
      robot,
      msg,
      targetRoomId || targetRoom,
      msg.match[2],
      msg.match[3],
      isPrivate,
    )
  })

  // TODO: do not list reminders in DMs unless called from the DM reminder is in
  robot.respond(/reminder list(?: (all|.*))?/i, function(msg) {
    let id, job, rooms, showAll, outputPrefix
    const targetRoom = msg.match[1]
    const roomId = msg.message.user.room
    let targetRoomId = null
    let output = ""

    outputPrefix = "Showing scheduled jobs for "

    if (isBlank(targetRoom) || config.denyExternalControl === "1") {
      // if targetRoom is undefined or blank, show reminders for current room
      // room is ignored when HUBOT_REMINDER_DENY_EXTERNAL_CONTROL is set to 1
      rooms = [roomId]
      outputPrefix += "THIS flow:\n"
    } else if (targetRoom === "all") {
      showAll = true
      outputPrefix += "ALL flows:\n"
    } else {
      targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)

      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        return msg.send(
          `Sorry, I'm not in the ${targetRoom} flow - or maybe you mistyped?`,
        )
      }
      rooms = [targetRoomId]
      outputPrefix += `the ${targetRoom} flow:\n`
    }

    // split jobs into date and cron pattern jobs
    const dateJobs = {}
    const cronJobs = {}
    for (id in REMINDER_JOBS) {
      job = REMINDER_JOBS[id]

      if (showAll || rooms.includes(job.user.room)) {
        if (!isCronPattern(job.pattern)) {
          dateJobs[id] = job
        } else {
          cronJobs[id] = job
        }
      }
    }

    // sort by date in ascending order
    for (id of Object.keys(dateJobs).sort(
      (a, b) => new Date(dateJobs[a].pattern) - new Date(dateJobs[b].pattern),
    )) {
      job = dateJobs[id]
      output += formatJobListItem(
        robot,
        job.pattern,
        (isCron = false),
        job.id,
        job.message,
        job.user.room,
        (showRoom = showAll),
      )
    }

    for (id in cronJobs) {
      job = cronJobs[id]
      output += formatJobListItem(
        robot,
        job.pattern,
        (isCron = true),
        job.id,
        job.message,
        job.user.room,
        (showRoom = showAll),
      )
    }

    if (!!output.length) {
      output = outputPrefix + "===\n" + output
      return msg.send(output)
    } else {
      return msg.send("No messages have been scheduled")
    }
  })

  robot.respond(/reminder (?:upd|update) (\d+) ((?:.|\s)*)/i, msg =>
    updateReminder(robot, msg, msg.match[1], msg.match[2]),
  )

  return robot.respond(/reminder (?:del|delete|remove|cancel) (\d+)/i, msg =>
    cancelSchedule(robot, msg, msg.match[1]),
  )
}

function createReminderJob(robot, msg, room, pattern, message, isPrivate) {
  let id
  if (JOB_MAX_COUNT <= Object.keys(REMINDER_JOBS).length) {
    return msg.send("Too many scheduled reminders")
  }

  while (id == null || REMINDER_JOBS[id]) {
    id = Math.floor(Math.random() * JOB_MAX_COUNT)
  }

  try {
    // TODO: parse pattern before trying to create job
    // TODO: determine whether to accept *only* natural language, or still support datetime and cron pattern input?

    // TESTING packages that use NLP to output cron patterns
    if (pattern.indexOf("every") > -1) {
      let pattern1 = getCronString(pattern, CRON_PATTERN_FORMAT)
      let pattern2 = crontalk.parse(pattern)
      let pattern3 = friendlyCron(pattern)
      // return msg.send(
      console.log(
        `The @darkeyedevelopers/natural-cron.js package outputs: ${pattern1}`,
        `The crontalk package outputs ${require("util").inspect(pattern2)}`,
        `The friendly-cron package outputs ${pattern3}`,
      )

      // TODO: strip seconds from pattern, or leave that option?
      // TODO: do strip whitespace after pattern so no implied seconds are created..
      pattern = pattern3
    } else {
      let refDate = Date.now()
      pattern = chrono.parseDate(pattern, refDate, { forwardDate: true })
    }

    // console.log(`(pattern.indexOf("every")): ${(pattern.indexOf("every"))}`)
    // TODO: set isPrivate here??
    console.log(
      `->->->->->->-> about to CreateReminder -> sending room: ${room}`,
    )

    const job = createReminder(
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
      return msg.send(`Reminder created:\n${formattedJob}`)
    } else {
      return msg.send(`\
\"${pattern}\" is an invalid pattern.
See http://crontab.org/ or https://crontab.guru/ for cron-style format pattern.
See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for datetime-based format pattern.\
`)
    }
  } catch (error) {
    return msg.send(error.message)
  }
}

function createReminder(robot, id, pattern, user, room, message, isPrivate) {
  // TODO: do I have a room here?
  console.log(
    `<<<<<<<<<< createReminder > room/ user.room: ${room}/ ${user.room}`,
  )

  if (isCronPattern(pattern)) {
    return createCronReminder(
      robot,
      id,
      pattern,
      user,
      room,
      message,
      isPrivate,
    )
  }

  const date = Date.parse(pattern)
  if (!isNaN(date)) {
    if (date < Date.now()) {
      throw new Error(`\"${pattern}\" has already passed`)
    }
    return createDatetimeReminder(
      robot,
      id,
      pattern,
      user,
      room,
      message,
      isPrivate,
    )
  }
}

var createCronReminder = (robot, id, pattern, user, room, message, isPrivate) =>
  startReminder(robot, id, pattern, user, room, message, isPrivate)

var createDatetimeReminder = (
  robot,
  id,
  pattern,
  user,
  room,
  message,
  isPrivate,
) =>
  startReminder(
    robot,
    id,
    new Date(pattern),
    user,
    room,
    message,
    isPrivate,
    function() {
      delete REMINDER_JOBS[id]
      return delete robot.brain.get(REMINDER_KEY)[id]
    },
  )

function startReminder(robot, id, pattern, user, room, message, isPrivate, cb) {
  if (!room) {
    // if a targetRoom isn't specified, send to current room
    // TODO: what is current room in a DM?
    // TODO: differentiate between a DM and a job w no room specified?
    console.log(
      `>>>>>>> startReminder > room/ user.room: ${room}/ ${user.room}`,
    )
    // TODO: set isPrivate here
    room = user.room
  }
  const job = new Job(id, pattern, user, room, message, isPrivate, cb)
  job.start(robot)
  REMINDER_JOBS[id] = job
  return (robot.brain.get(REMINDER_KEY)[id] = job.serialize())
}

function updateReminder(robot, msg, id, message) {
  const job = REMINDER_JOBS[id]
  if (!job) {
    return msg.send(`Reminder ${id} not found`)
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return msg.send(
      `Updating reminder for the ${getRoomNameFromId(
        robot.adapter,
        job.user.room,
      ) || job.user.room} flow is restricted`,
    )
  }

  job.message = message
  robot.brain.get(REMINDER_KEY)[id] = job.serialize()
  formattedJob = formatJobListItem(
    robot,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.room,
    job.room ? true : false,
  )
  return msg.send(`Reminder message updated:\n${formattedJob}`)
}

function cancelSchedule(robot, msg, id) {
  const job = REMINDER_JOBS[id]
  if (!job) {
    return msg.send(`${id}: Reminder not found`)
  }

  if (isRestrictedRoom(job.user.room, robot, msg)) {
    return msg.send(
      `Canceling reminder for the ${getRoomNameFromId(
        robot.adapter,
        job.user.room,
      ) || job.user.room} flow is restricted`,
    )
  }

  job.cancel()
  delete REMINDER_JOBS[id]
  delete robot.brain.get(REMINDER_KEY)[id]
  formattedJob = formatJobListItem(
    robot,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.room,
    job.room ? true : false,
  )
  return msg.send(`Reminder canceled:\n${formattedJob}`)
}

function syncReminders(robot) {
  let id, job
  if (!robot.brain.get(REMINDER_KEY)) {
    robot.brain.set(REMINDER_KEY, {})
  }

  const nonCachedReminders = difference(
    robot.brain.get(REMINDER_KEY),
    REMINDER_JOBS,
  )
  for (id of Object.keys(nonCachedReminders || {})) {
    job = nonCachedReminders[id]
    reminderFromBrain(robot, id, ...job)
  }

  const nonStoredReminders = difference(
    REMINDER_JOBS,
    robot.brain.get(REMINDER_KEY),
  )
  return (() => {
    const result = []
    for (id of Object.keys(nonStoredReminders || {})) {
      job = nonStoredReminders[id]
      result.push(storeReminderInBrain(robot, id, job))
    }
    return result
  })()
}

function reminderFromBrain(robot, id, pattern, user, message) {
  const envelope = {
    user,
    room: user.room,
  }
  try {
    createReminder(robot, id, pattern, user, user.room, message)
  } catch (error) {
    if (config.debug === "1") {
      robot.send(
        envelope,
        `${id}: Failed to schedule reminder from brain. [${error.message}]`,
      )
    }
    return delete robot.brain.get(REMINDER_KEY)[id]
  }

  if (config.debug === "1") {
    return robot.send(envelope, `${id} scheduled from brain`)
  }
}

function storeReminderInBrain(robot, id, job) {
  robot.brain.get(REMINDER_KEY)[id] = job.serialize()

  const envelope = {
    user: job.user,
    room: job.user.room,
  }
  if (config.debug === "1") {
    return robot.send(
      envelope,
      `${id}: Reminder stored in brain asynchronously`,
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
  if (config.denyExternalControl === "1") {
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
    for (let orgText in config.list.replaceText) {
      const replacedText = config.list.replaceText[orgText]
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
  constructor(id, pattern, user, room, message, isPrivate, cb) {
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
    this.isPrivate = isPrivate
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
      if (config.dontReceive !== "1") {
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
