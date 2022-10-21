// Description:
//   A place to play with new listeners and things
//
//   First up: dad-jokes. Because everyone loves a dad joke
//   Thanks to this handy blog:
//   https://keestalkstech.com/2018/01/hubot-es6-promises/
//   and https://icanhazdadjoke.com/api
//
// Configuration:
//
//
// Commands:
//   None
//
// Author:
//   kb0rg

import { Adapter, Robot, TextMessage } from "hubot"

module.exports = (robot: Robot<Adapter>) => {
  // robot.hear(
  //   /\bdad\b/i,
  //   {
  //     id: "dad-jokes",
  //   },
  //   res => {
  //     new Promise((resolve, reject) =>
  //       robot
  //         .http(dadJokeUrl)
  //         .headers(requestHeaders)
  //         .get()((err, response, body) => (err ? reject(err) : resolve(body))),
  //     )
  //       .then(body => JSON.parse(body))
  //       .then(json => decode(json.joke))
  //       .then(joke => res.send("Dad jokes? I got dad jokes! ", joke))
  //       .catch(err => res.send("Looks like Dad borked the internet: ", err))
  //   },
  // )
  robot.respond(/shrug(?!\W)/, (res) => {
    const messageToRobot = new TextMessage(res.message.user, "shrug.gif", "")
    // @ts-expect-error something is awry in the typing here...
    messageToRobot.metadata = res.message.metadata
    robot.adapter.receive(messageToRobot)
  })
}
