// A collection of adapter-helpers for hubot on flowdock
// These generally enhance or replace existing Flowdock adapter functionality,
// providing return values more suitable for error handling
// Additionally, these functions return immediately if the adapter in use isn't
// properly set up, or isn't a flowdock adapter

/*Given a robot and a room name, return the id of that room, based on
Flowdock flow information
Returns null if not found
If adapter isn't properly set up, or isn't a flowdock adapter, return null
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

/*Given a robot and a room id, return the name of that room, based on
Flowdock flow information
Returns null if not found
If adapter isn't properly set up, or isn't a flowdock adapter, return null
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

/*Given a robot and a room id or name, return the flow object for that room,
based on Flowdock flow information
Returns null if not found
If adapter isn't properly set up, or isn't a flowdock adapter, return null

The flow object returned from this function has the same structure as the
response listed for ‘Get a flow’ at https://www.flowdock.com/api/flows.
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

/*Given a robot, return an array of ids for flows the robot has joined,
based on Flowdock flow information
Returns empty array if robot has not joined any flows
If adapter isn't properly set up, or isn't a flowdock adapter, return empty array
*/
// TODO: refactor to make return value consitent
function getJoinedFlowIds(robot) {
  if (!robot.adapter.flows) {
    return []
  }
  return robot.adapter.joinedFlows().map(flow => flow.id)
}

/*Given a robot and a room id, returns (boolean) whether or not the robot
has joined the room, based on Flowdock flow information
If adapter isn't properly set up, or isn't a flowdock adapter, return false
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
