// Description:
//   Sets up a 200 response on / for GCP ingress healthchecks.
//
// Configuration:
//   None
//
// Commands:
//   None

import * as initWeb from "../web/init"

module.exports = function (robot) {
  initWeb(robot)
  robot.router.get("/", (req, res) =>
    res.status(200).send("I watch for Ragnarok."),
  )
}
