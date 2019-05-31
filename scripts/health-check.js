"use strict"

// Description:
//   Sets up a 200 response on / for GCP ingress healthchecks.
//
// Configuration:
//   None
//
// Commands:
//   None

module.exports = function(robot) {
  robot.router.get("/", (req, res) =>
    res.status(200).send("I watch for Ragnarok."),
  )
}
