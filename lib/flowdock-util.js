// A collection of adapter-helpers for hubot on flowdock

function getRoomIdFromName(robot, roomName) {
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
  // Returns a flow object with all available information about a given flow
  // or null
  // The response object is equivalent to a successful response from a GET call
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

function getJoinedFlowIds(robot) {
  if (!robot.adapter.flows) {
    return []
  }
  return robot.adapter.joinedFlows().map(flow => flow.id)
}

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
