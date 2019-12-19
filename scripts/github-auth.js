// Description:
//   Allows a chat user to register a GitHub API token with the bot via OAuth.
//
// Dependencies:
//   passport-init
//
// Configuration:
//   HUBOT_HOST - Hostname for the Hubot, sans trailing /, e.g. https://example.herokuapp.com
//   GITHUB_CLIENT_ID - client id for the GitHub OAuth Application that will be used
//   GITHUB_CLIENT_SECRET - client secret for the GitHub OAuth Application that will be used
//
// Commands:
//   hubot github auth - returns a URL where you can identify your GitHub self to the hubot. Upon identification, if a pending addition request exists from a call to `github add user`, it will be executed.

let passport = require("passport"),
  UUIDV4 = require("uuid/v4"),
  cookieParser = require("cookie-parser"),
  GitHubStrategy = require("passport-github2").Strategy,
  withConfigOrReportIssues = require("../lib/config").withConfigOrReportIssues

let HOST = process.env["HUBOT_HOST"],
  SECOND = 1000,
  MINUTE = 60 * SECOND

module.exports = function(robot) {
  withConfigOrReportIssues(
    issueReporterForRobot(robot),
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  )((githubClientId, githubClientSecret) => {
    robot.router.use(cookieParser())
    passport.use(
      new GitHubStrategy(
        {
          clientID: githubClientId,
          clientSecret: githubClientSecret,
          callbackURL: `${HOST}/github/auth`,
          userAgent: "https://thesis.co",
        },
        function(accessToken, refreshToken, profile, done) {
          done(null, { token: accessToken, profile: profile })
        },
      ),
    )

    function cleanPending() {
      let now = new Date().getTime(),
        pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}

      for (let [userID, pendingInfo] of Object.entries(pendingGitHubTokens)) {
        if (now - pendingInfo.date > 5 * MINUTE) {
          delete robot.brain.pendingGitHubTokens[userID]
        }
      }

      robot.brain.set("pendingGitHubTokens", pendingGitHubTokens)
    }

    setInterval(cleanPending, 30 * SECOND)
    cleanPending()

    robot.respond(/github auth/, res => {
      let user = res.message.user,
        token = UUIDV4()

      let pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}
      pendingGitHubTokens[user.id] = {
        token: token,
        date: new Date().getTime(),
      }
      robot.brain.set("pendingGitHubTokens", pendingGitHubTokens)

      res.send(
        `You can authorize access at ${HOST}/github/auth/${token} in the next 5 minutes.`,
      )
    })

    robot.router.get("/github/auth/:token", (req, res, next) => {
      let token = req.params.token,
        pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {},
        found = false

      for (let [userId, pendingInfo] of Object.entries(pendingGitHubTokens)) {
        if (token == pendingInfo.token) {
          found = true
          res.cookie("gh-auth-token", token, {
            httpOnly: true,
            //secure: true, TODO turn this on...
            sameSite: "Strict",
          })
          break
        }
      }

      if (found) {
        passport.authorize("github", { scope: ["admin:org"] })(req, res, next)
      } else {
        res.send(404, "File Not Found.")
      }
    })

    robot.router.get(
      "/github/auth",
      passport.authenticate("github", {
        failureRedirect: "/github/auth/fail",
        session: false,
        assignProperty: "gitHubUser",
      }),
      (req, res) => {
        let token = req.cookies["gh-auth-token"],
          gitHubToken = req.gitHubUser.token,
          pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {},
          gitHubTokens = robot.brain.get("gitHubTokens") || {},
          found = false

        for (let [userId, pendingInfo] of Object.entries(pendingGitHubTokens)) {
          if (token == pendingInfo.token) {
            delete pendingGitHubTokens[userId]
            gitHubTokens[userId] = gitHubToken

            robot.brain.set("pendingGitHubTokens", pendingGitHubTokens)
            robot.brain.set("gitHubTokens", gitHubTokens)

            found = true
            break
          }
        }

        res.cookie("gh-auth-token", "")
        if (found) {
          res.send(200, "<!doctype html><html><body>Got it!</body></html>")
        } else {
          res.send(404, "File Not Found.")
        }
      },
    )
  })
}
