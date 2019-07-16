// Provides a collection of adapter-helpers for hubot on flowdock, which
// enhance or replace existing Flowdock adapter functionality.
// These functions return immediately if the adapter in use isn't properly
// set up, or isn't a flowdock adapter, enabling better error handling.

/**
 * Given a robot and a room name, returns the id of that room, based on
 * Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 */
function getRoomIdFromName(robot, roomName) {
  if (!robot.adapter.flows) {
    return null
  }
  for (let flow of robot.adapter.flows || []) {
    if (roomName.toLowerCase() === flow.name.toLowerCase()) {
      return flow.id
    }
  }
  return null
}

/**
 * Given a robot and a room id, returns the name of that room, based on
 * Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 */
function getRoomNameFromId(robot, roomId) {
  if (!robot.adapter.flows) {
    return null
  }
  for (let flow of robot.adapter.flows || []) {
    if (roomId === flow.id) {
      return flow.name
    }
  }
  return null
}

/**
 * Given a robot and a room id or name, returns the flow object for that room,
 * based on Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 *
 * The flow object returned from this function has the same structure as the
 * response listed for ‘Get a flow’ at https://www.flowdock.com/api/flows.
 */
function getRoomInfoFromIdOrName(robot, roomIdOrName) {
  if (!robot.adapter.flows) {
    return null
  }
  let joinedFlowObjects = robot.adapter.joinedFlows()
  return (
    joinedFlowObjects.find(flow => {
      return (
        flow.id === roomIdOrName ||
        flow.name.toLowerCase() === roomIdOrName.toLowerCase()
      )
    }) || null
  )
}

/**
 * Given a robot, returns an array of ids for flows that the robot has joined,
 * based on Flowdock flow information.
 *
 * Returns an empty array if the robot has not joined any flows. If the adapter
 * isn't properly set up, or isn't a flowdock adapter, returns an empty array.
 */
function getJoinedFlowIds(robot) {
  if (!robot.adapter.flows) {
    return []
  }
  return robot.adapter.joinedFlows().map(flow => flow.id)
}

/**
 * Given a robot and a room id, returns a boolean indicating whether or not the
 * robot has joined the room, based on Flowdock flow information.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * false
 */
function robotIsInRoom(robot, roomId) {
  return getJoinedFlowIds(robot).indexOf(roomId) >= 0
}

module.exports = {
  getRoomIdFromName,
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
  getJoinedFlowIds,
  robotIsInRoom,
}
