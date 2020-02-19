// Description:
//   Allows a chat user registered via github-auth to perform certain actions.
//
// Dependencies:
//   github-auth
//
// Configuration:
//
// Commands:
//   hubot github who am i - returns your profile info
//   hubot github add <username> to [cardforcoin|keep-network] [<team>+] - Adds the given GitHub username to the specified teams in the given group. Teams are the URL name of the team, which has no spaces or special characters other than dashes. The username is a *chat* username, and that user must already have logged in using `github auth` to prove they own that username. If the user has not, the request to add them will be stored until they have.

let GitHubApi = require("github-api"),
  axios = require("axios")

let CLIENT_CACHE = new Map(),
  HOST = process.env["HUBOT_HOST"]

function apiFor(bot, user) {
  let api = CLIENT_CACHE[user],
    gitHubTokens = bot.brain.get("gitHubTokens") || {}

  if (!api) {
    let token = gitHubTokens[user.id]
    if (token) {
      api = new GitHubApi({ token: token })
    }
  }

  return api
}

module.exports = function(robot) {
  robot.respond(/github who am (i|I)/, res => {
    let api = apiFor(robot, res.message.user)

    if (api) {
      api
        .getUser()
        .getProfile()
        .then(response => {
          var string = ""
          for (let [key, value] of Object.entries(response.data)) {
            string += `${key}: ${value}\n`
          }

          res.send(`You are:\n${string}`)
        })
        .catch(error => {
          robot.logger.error("Error looking up user profile: ", error)
          res.send("Something went wrong looking you up :(")
        })
    } else {
      res.send(
        "You don't seem to be authenticated with GitHub; try sending me `github auth`!",
      )
    }
  })

  robot.respond(/github add ([^ ]+) to ([^ ]+)( .*)/, res => {
    let api = apiFor(robot, res.message.user)

    let [gitHubUsername, org, teamsString] = res.match.slice(1, 4)

    var teamSlugs = teamsString.split(/,? +/),
      slugsById = {}

    if (api) {
      api
        .getOrganization(org)
        .getTeams()
        .then(result => {
          if (result.status != 200) {
            robot.logger.error(
              `Error looking up org teams for ${org}: ${JSON.stringify(
                result.data,
              )}`,
            )
            throw `Failed to look up org teams for org ${org}.`
          } else {
            let selectedTeams = result.data.filter(
              _ => teamSlugs.indexOf(_.slug) > -1,
            )

            slugsById = selectedTeams.reduce((slugsById, team) => {
              slugsById[team.id] = team.slug
              return slugsById
            }, {})

            return Promise.all(
              selectedTeams.map(_ =>
                api
                  .getTeam(_.id)
                  .addMembership(gitHubUsername)
                  .catch(err => err.response),
              ),
            )
          }
        })
        .then(teamResponses => {
          let { successes, failures } = teamResponses.reduce(
            ({ successes, failures }, res) => {
              if (res.status == 200) {
                successes.push(res)
              } else {
                failures.push(res)
              }

              return { successes: successes, failures: failures }
            },
            { successes: [], failures: [] },
          )

          let allFailed = successes.length == 0,
            pending = successes.some(_ => _.data.state == "pending")

          if (failures.length > 0) {
            robot.logger.error(
              `Got failures adding ${gitHubUsername} to ${teamSlugs.join(
                ", ",
              )} in ${org}: ` +
                failures.map(_ => _.data.message).join(", ") +
                ".",
            )
          }

          let successTeams = successes
            .map(
              _ =>
                slugsById[_.data.url.replace(/^.*teams\/([^/]+)\/.*$/, "$1")],
            )
            .join(", ")

          if (allFailed && failures[0].status == 404) {
            res.send(`Unknown username ${gitHubUsername}.`)
          } else if (allFailed && failures[0].status == 422) {
            res.send(
              `User ${gitHubUsername} isn't in ${org} and there ` +
                `are no available seats; please add one at ` +
                `https://github.com/organizations/${org}/settings/billing/seats .`,
            )
          } else if (allFailed) {
            res.send(`Failed to add ${gitHubUsername} to any teams in ${org}.`)
          } else if (pending && failures.length > 0) {
            res.send(
              `Invited ${gitHubUsername} to ${successTeams} in ${org}, but the others failed.`,
            )
          } else if (pending) {
            res.send(`Invited ${gitHubUsername} to ${successTeams} in ${org}.`)
          } else if (failures.length > 0) {
            res.send(
              `Added ${gitHubUsername} to ${successTeams} in ${org}, but the others failed.`,
            )
          } else {
            res.send(`Added ${gitHubUsername} to ${successTeams} in ${org}.`)
          }
        })
        .catch(error => {
          robot.logger.error("Error looking up user profile: ", error)
          res.send(`Error adding ${gitHubUsername} to ${org}: ${error}.`)
        })
    } else {
      res.send(
        "You don't seem to be authenticated with GitHub; try sending me `github auth`!",
      )
    }
  })
}
