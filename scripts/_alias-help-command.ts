// Description:
//
// Fires prior to listeners, and checks the message for a robot invocation
//  that contains the word "help" as the 2nd or 3rd word. It then re-sends an
//  abbreviated and flipped copy of the message to the robot, in the correct
//   syntax trigger help if a valid command is present.
//
// Configuration: All middleware executes in the order in which it loads.
//   If you have other middleware that must run in a specific order
//   relative to this one, please rename your files accordingly to force them
//   to load in the correct order!
//   https://hubot.github.com/docs/scripting/#execution-process-and-api
//
// Commands:
//   hubot <command> help - redirects to `hubot help <command>`
//
// Author:
//   kb0rg

import { Robot, TextMessage } from "hubot"

export default function aliasHelpCommand(robot: Robot<any>) {
  robot.receiveMiddleware((context, next, done) => {
    const robotRespondPatternInText = robot
      .respondPattern(/ /)
      .exec(context.response?.message.text ?? "")
    if (robotRespondPatternInText) {
      // Strip robot pattern from message, clean up for next steps.
      const messageWords =
        context.response?.message.text
          ?.replace(robotRespondPatternInText[0], "")
          .trim()
          .toLowerCase()
          .split(" ") ?? []

      // Make sure the message contains "help" - but eliminate direct calls to help.
      if (messageWords.indexOf("help") <= 0) {
        return next(done)
      }
      // Expect "help" to be the second or third word in the message.
      // We want to avoid catching things like reminders with the word "help"
      // in the reminder message.
      if (messageWords.indexOf("help") <= 2 && context.response !== undefined) {
        const possibleCommand = messageWords[0]
        const flippedHelpRequest = `help ${possibleCommand}`
        const messageToRobot = new TextMessage(
          context.response.envelope.user,
          `${robot.alias}${flippedHelpRequest}`,
          "",
        )
        // Add metadata to message, if present, so reply is properly threaded.
        if (
          context.response.message &&
          "metadata" in context.response.message
        ) {
          // @ts-expect-error ignore missing metadata field since we know
          // metadata is available. Note that a better solution is needed, but
          // requires support from Hubot itself.
          messageToRobot.metadata = context.response.message.metadata
        }
        robot.adapter.receive(messageToRobot)
        return done()
      }
    }
    return next(done)
  })
}
