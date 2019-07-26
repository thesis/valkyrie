// Description:
//    A collection of helper functions for creating scheduled tasks with hubot in flowdock
//
// Dependencies:
//   "node-schedule" : "~1.0.0",
//   "cron-parser"   : "~1.0.1",
//   "cronstrue"     : "^1.68.0"
//

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

function syncJobs(robot, storage_key) {
  let id, job
  if (!robot.brain.get(storage_key)) {
    robot.brain.set(storage_key, {})
  }

  const nonCachedReminders = difference(
    robot.brain.get(storage_key),
    REMINDER_JOBS,
  )
  for (id of Object.keys(nonCachedReminders || {})) {
    job = nonCachedReminders[id]
    reminderFromBrain(robot, id, ...job)
  }

  const nonStoredReminders = difference(
    REMINDER_JOBS,
    robot.brain.get(storage_key),
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

module.exports = {
  createReminderJob,
  cancelSchedule,
  updateReminder,
  isBlank,
  syncJobs,
}
