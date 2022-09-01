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

export default function (robot: Robot<any>) {
  robot.respond(/users/i, (response) => {
    console.log("oh")
    response.reply(
      Object.values(robot.brain.users())
        .map((user) => ` - ${user.name}: ${user.id}`)
        .join("\n"),
    )
  })
}
