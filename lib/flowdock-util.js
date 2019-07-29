// Provides a collection of adapter-helpers for hubot on flowdock, which
// enhance or replace existing Flowdock adapter functionality.
// These functions return immediately if the adapter in use isn't properly
// set up, or isn't a flowdock adapter, enabling better error handling.

/**
 * Given a robotAdapter and a room name, returns the id of that room, based on
 * Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 */
function getRoomIdFromName(robotAdapter, roomName) {
  if (!robotAdapter.flows) {
    return null
  }
  for (let flow of robotAdapter.flows || []) {
    if (roomName.toLowerCase() === flow.name.toLowerCase()) {
      return flow.id
    }
  }
  return null
}

/**
 * Given a robotAdapter and a room id, returns the name of that room, based on
 * Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 */
function getRoomNameFromId(robotAdapter, roomId) {
  if (!robotAdapter.flows) {
    return null
  }
  for (let flow of robotAdapter.flows || []) {
    if (roomId === flow.id) {
      return flow.name
    }
  }
  return null
}

/**
 * Given a robotAdapter and a room id or name, returns the flow object for that
 * room, based on Flowdock flow information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * null.
 *
 * The flow object returned from this function has the same structure as the
 * response listed for ‘Get a flow’ at https://www.flowdock.com/api/flows.
 */
function getRoomInfoFromIdOrName(robotAdapter, roomIdOrName) {
  if (!robotAdapter.flows) {
    return null
  }
  let joinedFlowObjects = robotAdapter.joinedFlows()
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
 * Given a robotAdapter, returns an array of ids for flows that the robot has joined,
 * based on Flowdock flow information.
 *
 * Returns an empty array if the robot has not joined any flows. If the adapter
 * isn't properly set up, or isn't a flowdock adapter, returns an empty array.
 */
function getJoinedFlowIds(robotAdapter) {
  if (!robotAdapter.flows) {
    return []
  }
  return robotAdapter.joinedFlows().map(flow => flow.id)
}

// TODO: is this the right response to a non-Flowdock adapter?
/**
 * Given a robotAdapter and a room id or name, returns a boolean
 * indicating whether or not the Flowdock room is private, based on
 * the access_mode returned by the adapter with the room data.
 *
 * If the adapter is Not a Flowdock adapter, returns false
 *
 */
function isRoomInviteOnly(robotAdapter, robotAdapterName, roomIdOrName) {
  let flowData = getRoomInfoFromIdOrName(robotAdapter, roomIdOrName)
  if (flowData && flowData.access_mode === "invitation") {
    return true
  }
  return false
}

/**
 * Given a robotAdapter and a room name, returns a boolean indicating whether
 * or not the room name represents a valid Flowdock flow, based on whether a
 * flow id can be found based on the room name.
 *
 * If the room name passed as an argument is null, or if the adapter isn't
 * properly set up or isn't a flowdock adapter, returns false.
 */
function isRoomNameValid(robotAdapter, roomName) {
  if (!roomName || !getRoomIdFromName(robotAdapter, roomName)) {
    return false
  }
  return true
}

/**
 * Given a robotAdapter and a listener response object, returns a boolean
 * indicating whether or not the robot is using the Flowdock adapter, based on
 * the name of the robot adapter object constructor.
 *
 * If the adapter is Not a Flowdock adapter, returns true and responds with a
 * user warning indicating that this command won't work
 *
 * If the adapter IS using Flowdock, returns false
 */
function notUsingFlowdock(robotAdapter, response) {
  if (robotAdapter.constructor.name.toLowerCase() !== "flowdock") {
    response.send("Not using flowdock, can't complete request.")
    return true
  }
  return false
}

/**
 * Given a robotAdapter and a room id, returns a boolean indicating whether or
 * not the robot has joined the room, based on Flowdock flow information.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * false
 */
function robotIsInRoom(robotAdapter, roomId) {
  return getJoinedFlowIds(robotAdapter).indexOf(roomId) >= 0
}

module.exports = {
  getRoomIdFromName,
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
  getJoinedFlowIds,
  isRoomInviteOnly,
  isRoomNameValid,
  notUsingFlowdock,
  robotIsInRoom,
}
