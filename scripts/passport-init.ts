// Description:
//   Sets up passport for use in OAuth integrations like GitHub and G Suite.
import { Robot } from "hubot"
import * as passport from "passport"

module.exports = function setUpPassport(robot: Robot) {
  robot.router.use(passport.initialize())
}
