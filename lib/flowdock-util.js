// A collection of adapter-helpers for hubot on flowdock
// These generally enhance or replace existing Flowdock adapter functionality,
// providing return values more suitable for error handling
// Additionally, these functions return immediately if the adapter in use isn't
// properly set up, or isn't a flowdock adapter

function getRoomIdFromName(robot, roomName) {
  // Given a robot and a room name, return the id of that room, based on
  // Flowdock flow information
  // Returns null if not found
  // If adapter isn't properly set up, or isn't a flowdock adapter, return null

  if (!robot.adapter.flows) {
    return
  }
  for (let flow of robot.adapter.flows || []) {
    if (roomName.toLowerCase() === flow.name.toLowerCase()) {
      return flow.id
    }
  }
}

function getRoomNameFromId(robot, roomId) {
  // Given a robot and a room id, return the name of that room, based on
  // Flowdock flow information
  // Returns null if not found
  // If adapter isn't properly set up, or isn't a flowdock adapter, return null

  if (!robot.adapter.flows) {
    return
  }
  for (let flow of robot.adapter.flows || []) {
    if (roomId === flow.id) {
      return flow.name
    }
  }
}

function getRoomInfoFromIdOrName(robot, roomIdOrName) {
  // Given a robot and a room id or name, return the flow object for that room,
  // based on Flowdock flow information
  // Returns null if not found
  // If adapter isn't properly set up, or isn't a flowdock adapter, return null

  // The returned object is equivalent to a successful response from a GET call
  // to either of the following endpoints in the flowdock api:
  // `/flows/:organization/:flow` (get flow by name)
  // `/flows/find?id=:id` (get flow by ID)
  // This allows us to bypass the API, and offers more detailed information
  // than the adapter provides with its `findFlow` (which only returns id)
  // or its `flowFromParams` (which only looks up by id)
  // This also allows us to return a reasonable default if not using flowdock
  // For full reponse object details see:
  // https://www.flowdock.com/api/flows

  if (!robot.adapter.flows) {
    return
  }
  let joinedFlowObjects = robot.adapter.joinedFlows()
  return joinedFlowObjects.find(flow => {
    return (
      flow.id === roomIdOrName ||
      flow.name.toLowerCase() === roomIdOrName.toLowerCase()
    )
  })
}

// TODO: refactor to make return value consitent
function getJoinedFlowIds(robot) {
  // Given a robot, return an array of ids for flows the robot has joined,
  // based on Flowdock flow information
  // Returns null if not found
  // If adapter isn't properly set up, or isn't a flowdock adapter, return empty array

  if (!robot.adapter.flows) {
    return []
  }
  return robot.adapter.joinedFlows().map(flow => flow.id)
}

function robotIsInRoom(robot, roomId) {
  // Given a robot and a room id, return (boolean) whether or not the robot
  // has joined the room, based on Flowdock flow information
  // If adapter isn't properly set up, or isn't a flowdock adapter, return false

  return getJoinedFlowIds(robot).indexOf(roomId) >= 0
}

module.exports = {
  getRoomIdFromName,
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
  getJoinedFlowIds,
  robotIsInRoom,
}
