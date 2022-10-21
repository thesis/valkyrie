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

const passport = require("passport")
const UUIDV4 = require("uuid/v4")
const cookieParser = require("cookie-parser")
const GitHubStrategy = require("passport-github2").Strategy
const { withConfigOrReportIssues } = require("../lib/config")
const { issueReporterForRobot } = require("../lib/config")

const HOST = process.env.HUBOT_HOST
const SECOND = 1000
const MINUTE = 60 * SECOND

module.exports = function (robot) {
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
        (accessToken, refreshToken, profile, done) => {
          done(null, { token: accessToken, profile })
        },
      ),
    )

    function cleanPending() {
      const now = new Date().getTime()
      const pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}

      for (const [userID, pendingInfo] of Object.entries(pendingGitHubTokens)) {
        if (now - pendingInfo.date > 5 * MINUTE) {
          delete pendingGitHubTokens[userID]
        }
      }

      robot.brain.set("pendingGitHubTokens", pendingGitHubTokens)
    }

    setInterval(cleanPending, 30 * SECOND)
    cleanPending()

    robot.respond(/github auth/, (res) => {
      const { user } = res.message
      const token = UUIDV4()

      const pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}
      pendingGitHubTokens[user.id] = {
        token,
        date: new Date().getTime(),
      }
      robot.brain.set("pendingGitHubTokens", pendingGitHubTokens)

      res.send(
        `You can authorize access at ${HOST}/github/auth/${token} in the next 5 minutes.`,
      )
    })

    robot.router.get("/github/auth/:token", (req, res, next) => {
      const { token } = req.params
      const pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}
      let found = false

      for (const [userId, pendingInfo] of Object.entries(pendingGitHubTokens)) {
        if (token == pendingInfo.token) {
          found = true
          res.cookie("gh-auth-token", token, {
            httpOnly: true,
            // secure: true, TODO turn this on...
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
        const token = req.cookies["gh-auth-token"]
        const gitHubToken = req.gitHubUser.token
        const pendingGitHubTokens = robot.brain.get("pendingGitHubTokens") || {}
        const gitHubTokens = robot.brain.get("gitHubTokens") || {}
        let found = false

        for (const [userId, pendingInfo] of Object.entries(
          pendingGitHubTokens,
        )) {
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
