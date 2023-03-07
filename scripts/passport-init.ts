// Description:
//   Sets up passport for use in OAuth integrations like GitHub and G Suite.
import { Robot } from "hubot"
import passport from "passport"

export default function setUpPassport(robot: Robot) {
  robot.router.use(passport.initialize())
}
