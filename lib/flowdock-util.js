// A collection of adapter-helpers for hubot on flowdock

function getRoomIdFromName(robot, roomName) {
  if (!robot.adapter.findFlow) {
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
