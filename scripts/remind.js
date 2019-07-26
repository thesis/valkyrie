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
  createReminderJob,
  cancelSchedule,
  updateReminder,
  isBlank,
  syncJobs,
} = require("../lib/schedule-utils")

const {
  getRoomIdFromName,
  getRoomNameFromId,
  robotIsInRoom,
} = require("../lib/flowdock-util")

const REMINDER_JOBS = {}
const REMINDER_KEY = "hubot_reminders"
const CRON_PATTERN_FORMAT = "MIN HOR DOM MON WEK"

module.exports = function(robot) {
  robot.brain.on("loaded", () => {
    return syncJobs(robot)
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
