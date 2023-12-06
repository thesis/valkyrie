// Description:
//   Sets up a 200 response on / for GCP ingress healthchecks.
//
// Configuration:
//   None
//
// Commands:
//   None

import { Robot } from "hubot"

export default function setUpHealthCheck(robot: Robot) {
  robot.router.get("/", (req, res) =>
    res.status(200).send("I watch for Ragnarok."),
  )
}
