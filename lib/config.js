const { getRoomIdFromName } = require("../lib/flowdock-util")

function isAlertRoomNameValid(robot, alertRoomName) {
  if (!alertRoomName || !getRoomIdFromName(robot, alertRoomName)) {
    return false
  }
  return true
}

function fetchAlertRoomOrReportIssue(robot, alertRoomName) {
  if (!isAlertRoomNameValid(robot, alertRoomName)) {
    let alertRoomErrorMessage = `Could not get flow id for alertRoomName: ${alertRoomName}`
    if (robot.adapterName.toLowerCase() == "shell") {
      // this is local dev, just log it, return alertRoomName
      robot.logger.error(alertRoomErrorMessage)
    } else {
      // fail build if not using shell adapter: alerts won't work w/o valid room
      throw new Error(alertRoomErrorMessage)
    }
  }
  return alertRoomName
}

module.exports = {
  isAlertRoomNameValid,
  fetchAlertRoomOrReportIssue,
}
