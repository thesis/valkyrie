// Provides a collection of configuration validation helpers

const { getRoomIdFromName } = require("../lib/flowdock-util")

/* Given a robot and a room name, returns a boolean indicating whether or not
 * the room name represents a valid Flowdock flow, based on whether a flow id
 * can be found based on the room name.
 *
 * If the room name passed as an argument is null, or if the adapter isn't
 * properly set up or isn't a flowdock adapter, returns false.
 */
function isAlertRoomNameValid(robot, alertRoomName) {
  if (!alertRoomName || !getRoomIdFromName(robot, alertRoomName)) {
    return false
  }
  return true
}

/* Given a robot and a room name, checks the validity of the room name based on
 * the criteria outlined in the isAlertRoomNameValid function, and returns the
 * room name if valid.
 *
 * If the room name is invalid, logs if the robot is using the shell adapter,
 * and returns the (invalid) room name. If the robot is using any other adapter,
 * throws an error.
 */
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
