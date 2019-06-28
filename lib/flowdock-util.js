// A collection of adapter-helpers for hubot on flowdock

function getRoomIdFromName(robot, roomName) {
  // script loading fails here without the check for robot.adapter.flows
  if (!robot.adapter.flows || !robot.adapter.findFlow) {
    // in some cases, returning the room name will bork things, so we should log
    robot.logger.info(`getRoomIdFromName couldn't find flow id for ${roomName}`)
    return roomName
  } else {
    return robot.adapter.findFlow(roomName)
  }
}

function getRoomNameFromId(robot, roomId) {
  if (!robot.adapter.flows) {
    return roomId
  } else {
    for (let flow of robot.adapter.flows || []) {
      if (roomId === flow.id) {
        return flow.name
      }
    }
  }
}

function getJoinedFlowIds(robot) {
  if (!robot.adapter.flows) {
    return []
  } else {
    return robot.adapter.joinedFlows().map(flow => flow.id)
  }
}

function robotIsInRoom(robot, roomId) {
  return getJoinedFlowIds(robot).indexOf(roomId) >= 0
}

module.exports = {
  getRoomIdFromName,
  getRoomNameFromId,
  getJoinedFlowIds,
  robotIsInRoom,
}
