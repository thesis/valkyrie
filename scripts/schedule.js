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
  createScheduledJob,
  isBlank,
  isCronPattern,
  updateScheduledJob,
  cancelScheduledJob,
  getScheduledJobList,
  formatJobsForListMessage,
} = require("../lib/schedule-util")

const JOBS = {}
const STORE_KEY = "hubot_schedule"

module.exports = function(robot) {
  robot.brain.on("loaded", () => {
    return syncSchedules(robot, STORE_KEY, JOBS)
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
      return createScheduledJob(
        robot,
        JOBS,
        STORE_KEY,
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

    const [dateJobs, cronJobs] = getScheduledJobList(JOBS, showAll, rooms)

    output = formatJobsForListMessage(robot.adapter, dateJobs, false, showAll)
    output += formatJobsForListMessage(robot.adapter, cronJobs, true, showAll)

    if (!!output.length) {
      output = outputPrefix + "===\n" + output
      return msg.send(output)
    } else {
      return msg.send("No messages have been scheduled")
    }
  })

  robot.respond(/schedule (?:upd|update) (\d+) ((?:.|\s)*)/i, msg =>
    updateScheduledJob(robot, JOBS, STORE_KEY, msg, msg.match[1], msg.match[2]),
  )

  return robot.respond(/schedule (?:del|delete|remove|cancel) (\d+)/i, msg =>
    cancelScheduledJob(robot, JOBS, STORE_KEY, msg, msg.match[1]),
  )
}
