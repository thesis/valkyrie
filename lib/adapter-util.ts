// Provides a collection of adapter-helpers for hubot on flowdock, which
// enhance or replace existing Flowdock adapter functionality.
// These functions return immediately if the adapter in use isn't properly
// set up, or isn't a flowdock adapter, enabling better error handling.

import { Adapter } from "hubot"
import { Matrix } from "hubot-matrix"
import { JoinRule } from "matrix-js-sdk"

let roomIDByLowercaseName: { [lowercaseRoomName: string]: string } = {}

/**
 * Returns whether a given adapter is a Matrix adapter. Using instanceof does
 * not work for unclear reasons, so a type guard is introduced to do the check.
 */
function isMatrixAdapter(adapter: Adapter): adapter is Matrix {
  return adapter.constructor === Matrix
}

/**
 * Given a robotAdapter and a room name, returns the id of that room, based on
 * adapter room information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or doesn't support this lookup, or the
 * room is unknown, returns undefined.
 */
function getRoomIdFromName(
  robotAdapter: Adapter,
  roomName: string,
): string | undefined {
  const lowercaseRoomName = roomName.toLowerCase()

  if (lowercaseRoomName in roomIDByLowercaseName) {
    return roomIDByLowercaseName[lowercaseRoomName]
  }

  if (isMatrixAdapter(robotAdapter)) {
    const rooms = robotAdapter.client?.getRooms()
    roomIDByLowercaseName =
      rooms?.reduce(
        (roomIDByLowercaseName, room) => (
          (roomIDByLowercaseName[room.normalizedName.toLowerCase()] =
            room.roomId),
          roomIDByLowercaseName
        ),
        {} as typeof roomIDByLowercaseName,
      ) ?? roomIDByLowercaseName

    return roomIDByLowercaseName[lowercaseRoomName]
  }

  return
}

/**
 * Given a robotAdapter and a room id, returns the name of that room, based on
 * adapter room information. Returns null if not found.
 *
 * If the adapter isn't properly set up, or doesn't support this lookup,
 * returns undefined.
 */
function getRoomNameFromId(
  robotAdapter: Adapter,
  roomId: string,
): string | undefined {
  if (isMatrixAdapter(robotAdapter)) {
    return robotAdapter.client?.getRoom(roomId)?.name
  }

  return
}

export type RoomInfo = {
  roomId: string
  roomName: string
  accessType: "public" | "non-public"
}

/**
 * Given a robotAdapter and a room id or name, returns the room info for that
 * room, based on adapter room information. Returns undefined if not found.
 *
 * If the adapter isn't properly set up, or doesn't support this lookup,
 * returns null.
 *
 * The flow object returned from this function has the same structure as the
 * response listed for ‘Get a flow’ at https://www.flowdock.com/api/flows.
 */
function getRoomInfoFromIdOrName(
  robotAdapter: Adapter,
  roomIdOrName: string,
): RoomInfo | undefined {
  if (!isMatrixAdapter(robotAdapter)) {
    return undefined
  }

  const rooms = robotAdapter.client?.getRooms() ?? []
  const matchingRoom = rooms.find(
    (room) =>
      room.roomId === roomIdOrName ||
      room.name.toLowerCase() === roomIdOrName.toLowerCase(),
  )

  if (matchingRoom) {
    return {
      roomId: matchingRoom.id,
      roomName: matchingRoom.name,
      accessType:
        matchingRoom.getJoinRule() === JoinRule.Public
          ? "public"
          : "non-public",
    }
  }

  return
}

/**
 * Given a robotAdapter, returns an array of ids for rooms that the robot has
 * joined, based on adapter room information.
 *
 * Returns an empty array if the robot has not joined any rooms. If the adapter
 * isn't properly set up, or doesn't support this lookup, returns an empty array.
 */
async function getAllJoinedRoomIds(robotAdapter: Adapter): Promise<string[]> {
  if (isMatrixAdapter(robotAdapter)) {
    return (await robotAdapter.client?.getJoinedRooms())?.joined_rooms ?? []
  }
  return []
}

/**
 * Given a robotAdapter, returns an array of ids for public (not non-public)
 * rooms that the robot has joined, based on adapter room information.
 *
 * Returns an empty array if the robot has not joined any rooms or if all
 * joined rooms are non-public. If the adapter isn't properly set up, or
 * doesn't support this lookup, returns an empty array.
 */
async function getPublicJoinedRoomIds(
  robotAdapter: Adapter,
): Promise<string[]> {
  if (isMatrixAdapter(robotAdapter)) {
    return (
      (await robotAdapter.client?.getJoinedRooms())?.joined_rooms.filter(
        (roomId) =>
          getRoomInfoFromIdOrName(robotAdapter, roomId)?.accessType ===
          "public",
      ) ?? []
    )
  }
  return []
}

/**
 * Given a robotAdapter and a room name, returns a boolean indicating whether
 * or not the room name represents a valid room to this adapter, based on
 * whether a room id can be found based on the room name.
 *
 * If the room name passed as an argument is null, or if the adapter isn't
 * properly set up or isn't a flowdock adapter, returns false.
 */
function isRoomNameValid(robotAdapter: Adapter, roomName: string): boolean {
  if (!roomName || !getRoomIdFromName(robotAdapter, roomName)) {
    return false
  }
  return true
}

/**
 * Given a robotAdapter and a room id, returns a boolean indicating whether or
 * not the robot has joined the room, based on Flowdock flow information.
 *
 * If the adapter isn't properly set up, or isn't a flowdock adapter, returns
 * false
 */
async function robotIsInRoom(
  robotAdapter: Adapter,
  roomId: string,
): Promise<boolean> {
  return (await getAllJoinedRoomIds(robotAdapter)).indexOf(roomId) >= 0
}

/**
 * Given a thread id, returns an encoded copy of the thread id, with dashes
 * replaced.
 *
 * We encountered a bug constructing markdown-formatted links with some thread
 * ids, specifically those ending in "--". Since encodeURIComponent doesn't
 * replace dashes, we have to do a string replace as well.
 */
function encodeThreadId(threadId: string) {
  return encodeURIComponent(threadId).replace(/-/g, "%2D")
}

export function isRoomNonPublic(
  adapter: Adapter,
  targetRoomId: string,
): boolean {
  if (adapter instanceof Matrix) {
    return (
      getRoomInfoFromIdOrName(adapter, targetRoomId)?.accessType !== "public" ??
      false
    )
  }
  return false
}

export {
  getRoomIdFromName,
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
  getAllJoinedRoomIds,
  getPublicJoinedRoomIds,
  encodeThreadId,
  isRoomNameValid,
  robotIsInRoom,
}
