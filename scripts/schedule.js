// Description:
//   Schedule a message in both cron-style and datetime-based format pattern
//   Modified for flowdock, and converted to JS
//
//
// Commands:
//   hubot schedule [add|new] "<datetime pattern>" <message> - Schedule a message that runs on a specific date and time. "YYYY-MM-DDTHH:mm" for UTC, or "YYYY-MM-DDTHH:mm-HH:mm" to specify a timezone offset. See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for more on datetime pattern syntax.
//   hubot schedule [add|new] "<cron pattern>" <message> - Schedule a message that runs recurrently. For the wizards only. See http://crontab.org/ for cron pattern syntax.
//   hubot schedule [add|new] <flow> "<datetime pattern>" <message> - Schedule a message to a specific flow that runs on a specific date and time.
//   hubot schedule [add|new] <flow> "<cron pattern>" <message> - Schedule a message to a specific flow that runs recurrently
//   hubot schedule [cancel|del|delete|remove] <id> - Cancel the schedule
//   hubot schedule [upd|update] <id> <message> - Update scheduled message
//   hubot schedule list - List all scheduled messages for current flow. NOTE all times are listed in UTC
//   hubot schedule list <flow> - List all scheduled messages for specified flow. NOTE all times are listed in UTC
//   hubot schedule list all - List all scheduled messages for any flows. NOTE all times are listed in UTC
//
// Author:
//   kb0rg
//   matsukaz <matsukaz@gmail.com>
//

const { getRoomIdFromName, robotIsInRoom } = require("../lib/flowdock-util")

const {
  CONFIG,
  syncSchedules,
  isRestrictedRoom,
  schedule,
  isBlank,
  isCronPattern,
  formatJobListItem,
  updateSchedule,
  cancelSchedule,
} = require("../lib/schedule-util")

// TODO: Update lib functions to accept these as params?
const JOBS = {}
const JOB_MAX_COUNT = 10000
const STORE_KEY = "hubot_schedule"

module.exports = function(robot) {
  robot.brain.on("loaded", () => {
    return syncSchedules(robot)
  })

  if (!robot.brain.get(STORE_KEY)) {
    robot.brain.set(STORE_KEY, {})
  }

  robot.respond(
    /schedule (?:new|add)(?: (.*))? "(.*?)" ((?:.|\s)*)$/i,
    function(msg) {
      let targetRoom = msg.match[1] // optional name of room specified in msg
      let targetRoomId = null

      if (!isBlank(targetRoom)) {
        targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)

        if (isRestrictedRoom(targetRoomId, robot, msg)) {
          return msg.send(
            `Creating schedule for the ${targetRoom} flow is restricted`,
          )
        }

        if (!robotIsInRoom(robot.adapter, targetRoomId)) {
          return msg.send(
            `Can't create schedule for ${targetRoom}: I'm not in that flow, or there's a typo in the name`,
          )
        }
      }
      return schedule(
        robot,
        msg,
        targetRoomId || targetRoom,
        msg.match[2],
        msg.match[3],
      )
    },
  )

  robot.respond(/schedule list(?: (all|.*))?/i, function(msg) {
    let id, job, rooms, showAll, outputPrefix
    const targetRoom = msg.match[1]
    const roomId = msg.message.user.room
    let targetRoomId = null
    let output = ""

    outputPrefix = "Showing scheduled jobs for "

    if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
      // if targetRoom is undefined or blank, show schedule for current room
      // room is ignored when HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL is set to 1
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
    for (id in JOBS) {
      job = JOBS[id]

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

  robot.respond(/schedule (?:upd|update) (\d+) ((?:.|\s)*)/i, msg =>
    updateSchedule(robot, msg, msg.match[1], msg.match[2]),
  )

  return robot.respond(/schedule (?:del|delete|remove|cancel) (\d+)/i, msg =>
    cancelSchedule(robot, msg, msg.match[1]),
  )
}
