// Description:
//   A collection of utilities to get information related to flowdock usage.
//
// Configuration:
//   HUBOT_FLOWDOCK_API_TOKEN
//
// Commands:
//   hubot reconnect <optional reason for reconnecting> - reconnects to the flowdock stream
//   hubot users [flowdock|robot] - responds with a list of Flowdock users as User Name: user-id
//
// Author:
//   shadowfiend
//   kb0rg

import { Robot } from "hubot"
import { MatrixEvent, EventType, RoomMemberEvent } from "matrix-js-sdk"
import * as hubot from "hubot"
import { isMatrixAdapter } from "../lib/adapter-util"
import { generateAvatar, roomNameToAlias } from "../lib/matrix-room-utils"

const SPACE_BASE_COLORS: { [spaceName: string]: string } = {
  Thesis: "#000000",
  Keep: "#49DBB4",
  "Tally Ho": "#EE9C32",
  Fold: "#FFCF30",
  Embody: "#0B3CF1",
}

const SPACE_IDS: { [spaceName: string]: string } = {
  Thesis: "!outFXRZStxHJasvWKL:thesis.co",
  Keep: "!YDpOcIsEpQabwiHpdV:thesis.co",
  "Tally Ho": "!wCfAwzfZOUHTYIDjRn:thesis.co",
  Fold: "!SuBAnawNxcIXoCHfPM:thesis.co",
  Embody: "!XEnwlDoWvSBvrloDVH:thesis.co",
}

const SPACE_NAMES: { [spaceId: string]: string } = Object.fromEntries(
  Object.entries(SPACE_IDS).map(([name, id]) => [id, name]),
)

const SUPER_ADMIN_USERS = ["@matt:thesis.co", "@shadowfiend:thesis.co"]

const ADMIN_USERS = [
  ...SUPER_ADMIN_USERS,
  "@puppycodes:thesis.co",
  "@carolyn:thesis.co",
  "@gluzman:thesis.co",
  "@jessiefrance:thesis.co",
  "@veronica:thesis.co",
]

// Additional per-space admins beyond the core Thesis admins.
const SPACE_ADMINS: { [spaceRoomId: string]: string[] } = {
  // Thesis* space.
  "!outFXRZStxHJasvWKL:thesis.co": [],
  // Keep space.
  "!YDpOcIsEpQabwiHpdV:thesis.co": ["@piotr.dyraga:thesis.co"],
  // Tally Ho space.
  "!wCfAwzfZOUHTYIDjRn:thesis.co": [
    "@michaelh:thesis.co",
    "@puppycodes:thesis.co",
  ],
  // Fold space.
  "!SuBAnawNxcIXoCHfPM:thesis.co": [
    "@tom:thesis.co",
    "@willreeves:thesis.co",
    "@puppycodes:thesis.co",
  ],
  // Power Period space.
  "!XEnwlDoWvSBvrloDVH:thesis.co": ["@anna:thesis.co"],
}

module.exports = (robot: Robot<any>) => {
  robot.respond(/users/i, (response) => {
    response.reply(
      `\n${Object.values(robot.brain.users())
        .map((user) => ` - ${user.name}: ${user.id}`)
        .join("\n")}`,
    )
  })

  if (isMatrixAdapter(robot.adapter)) {
    const { adapter } = robot
    const { client } = adapter
    if (client === undefined || client.getUserId() === null) {
      return
    }

    const botUserId = client.getUserId()
    if (botUserId === null) {
      return
    }

    robot.respond(/relinquish admin/i, async (response) => {
      if (SUPER_ADMIN_USERS.includes(response.envelope.user.id)) {
        const roomFromEnvelope = client.getRoom(response.envelope.room)
        const roomId =
          roomFromEnvelope === null
            ? (await client.getRoomIdForAlias(response.envelope.room)).room_id
            : response.envelope.room
        const room = roomFromEnvelope ?? client.getRoom(roomId)

        const existingLevels = room?.currentState
          .getStateEvents(EventType.RoomPowerLevels)
          ?.at(0)

        if (existingLevels === undefined) {
          response.reply(
            "Failed to relinquish admin; unable to look up existing power levels.",
          )
        } else {
          response.reply(
            "Roger, setting you to admin and relinquishing admin...",
          )

          const existingContent = existingLevels.getContent()
          client.setPowerLevel(
            roomId,
            response.envelope.user.id,
            100,
            new MatrixEvent({
              ...existingLevels.event,
              content: {
                ...existingContent,
                users: {
                  ...existingContent.users,
                  [botUserId]: 0,
                },
              },
            }),
          )
        }
      } else {
        response.reply("Sorry, you can't make me relinquish admin!")
      }
    })

    const hubotUser = new hubot.User(botUserId)
    const envelopeForRoom = (roomId: string) => ({
      user: hubotUser,
      room: roomId,
      message: new hubot.Message(hubotUser),
    })

    client.on(RoomMemberEvent.PowerLevel, async (event, member) => {
      const roomId = event.getRoomId()
      if (roomId === undefined) {
        return
      }

      const room = client.getRoom(roomId)
      if (room === null) {
        return
      }
      /*
         Event to set full join across hierarchy:

        {
          "content": {
            "allow": [
              {
                "room_id": "!VRGYJeUwuhkMmZPcpX:thesis.co",
                "type": "m.room_membership"
              },
              {
                "room_id": "!outFXRZStxHJasvWKL:thesis.co",
                "type": "m.room_membership"
              }
            ],
            "join_rule": "restricted"
          },
          "origin_server_ts": 1666321627230,
          "sender": "@shadowfiend:thesis.co",
          "state_key": "",
          "type": "m.room.join_rules",
          "unsigned": {
            "replaces_state": "$tllXoJSLMb6TeRILvTFfm4-oGEhZcg8vjlcWIX65hf4",
            "prev_content": {
              "allow": [
                {
                  "room_id": "!VRGYJeUwuhkMmZPcpX:thesis.co",
                  "type": "m.room_membership"
                }
              ],
              "join_rule": "restricted"
            },
            "prev_sender": "@matt:thesis.co",
            "age": 164
          },
          "event_id": "$V44XsTkvXTOT-_BP1RoAZPNUOydtZiXnyQ_xKCSRXxw",
          "room_id": "!rWLGMyTmMPeePdBwHb:thesis.co"
        }
*/

      if (
        member.userId === client.getUserId() &&
        member.powerLevel === 100 &&
        roomId !== undefined
      ) {
        const parentRoomIds = []
        let currentParents = room.currentState.getStateEvents(
          EventType.SpaceParent,
        )
        while (
          currentParents.length > 0 &&
          currentParents[0].event.state_key !== undefined
        ) {
          const parentId = currentParents[0].event.state_key
          parentRoomIds.push(parentId)
          currentParents =
            client
              .getRoom(parentId)
              ?.currentState.getStateEvents(EventType.SpaceParent) ?? []
        }

        const admins = ADMIN_USERS.concat(
          parentRoomIds.flatMap(
            (parentRoomId) => SPACE_ADMINS[parentRoomId] ?? [],
          ),
        )

        const existingAlias = room.getCanonicalAlias()
        const updatedAlias =
          existingAlias === null
            ? `#${roomNameToAlias(room.name)}:${client.getDomain()}`
            : undefined

        // TODO How do we handle cases where multiple spaces have the same room
        // TODO name? Should all non-Thesis level rooms have their containing
        // TODO space prefixed?
        if (updatedAlias !== undefined) {
          client.sendEvent(roomId, EventType.RoomCanonicalAlias, {
            alias: updatedAlias,
          })
        }

        const spaceBaseColor = parentRoomIds
          .map(
            (parentRoomId) =>
              SPACE_BASE_COLORS[
                Object.entries(SPACE_IDS).find(
                  ([, id]) => parentRoomId === id,
                )?.[0] ?? ""
              ],
          )
          .find((baseColor) => baseColor !== undefined)

        if (spaceBaseColor !== undefined) {
          const { filename, pngStream } = generateAvatar(
            room.name,
            spaceBaseColor,
          )
          const json = await client.uploadContent(pngStream, {
            name: filename,
            type: "image/png",
            rawResponse: false,
          })
          const contentUri = json.content_uri

          await client.sendStateEvent(roomId, "m.room.avatar", {
            url: contentUri,
          })
        }

        adapter.send(
          envelopeForRoom(roomId),
          `
          I took over admin privileges! This means the admin power level is now
          95, Thesis-wide admins have that power level, as do Space-specific
          admins. adminbot and I will remain at 100 so we can make any future
          updates.

          I'm also making sure there's a user-friendly alias for this room across
          chat.thesis.co; henceforth, this room shall be ${
            existingAlias ?? updatedAlias
          }. Last but not least---this room has an avatar!
        `
            .replace(/(?<!\n)\n(?!\n)/gm, " ")
            .replace(/^[ \t]+/gm, ""),
        )

        const adminPowerLevels = Object.fromEntries(
          admins.map((adminUserId) => [adminUserId, 95] as const),
        )
        const existingContent = event.getContent()
        client.setPowerLevel(
          roomId,
          botUserId,
          100,
          new MatrixEvent({
            ...event.event,
            content: {
              ...existingContent,
              users: {
                ...existingContent.users,
                ...adminPowerLevels,
              },
            },
          }),
        )
      }
    })
  }
}
