# Description:
#   Allows a chat user to register a GitHub API token with the bot via a simple
#   form.  Also allows that chat user to perform certain actions:
#    - Adding a user to the organization.
#
# Dependencies:
#   That's a negatory.
#
# Configuration:
#   HUBOT_HOST - Hostname for the Hubot, sans trailing /, e.g. https://example.herokuapp.com
#
# Commands:
#   hubot github auth - returns a URL where you can identify your GitHub self to the hubot. Upon identification, if a pending addition request exists from a call to `github add user`, it will be executed.
#   hubot github who am i - returns your profile info
#   hubot github add <username> to [cardforcoin|keep-network] [<team>+] - Adds the given GitHub username to the specified teams in the given group. Teams are the URL name of the team, which has no spaces or special characters other than dashes. The username is a *chat* username, and that user must already have logged in using `github auth` to prove they own that username. If the user has not, the request to add them will be stored until they have.

GitHubApi = require 'github-api'
UUIDV4 = require 'uuid/v4'
axios = require 'axios'

CLIENT_CACHE = {}
HOST = process.env['HUBOT_HOST']

apiFor = (bot, user) ->
  api = CLIENT_CACHE[user]
  unless api?
    token = bot.brain.gitHubTokens[user.id]
    if token
      api = new GitHubApi token: token

  api

SECOND = 1000
MINUTE = 60 * SECOND

module.exports = (robot) ->
  robot.brain.pendingGitHubTokens ||= {}
  robot.brain.gitHubTokens ||= {}

  cleanPending = ->
    now = (new Date).getTime()
    for userId, pendingInfo of robot.brain.pendingGitHubTokens when (now - pendingInfo.date) > (5 * MINUTE)
      delete robot.brain.pendingGitHubTokens[userId]

  setInterval cleanPending, 30000

  robot.respond /github auth/, (res) ->
    user = res.message.user
    token = UUIDV4()

    robot.brain.pendingGitHubTokens ||= {}
    robot.brain.pendingGitHubTokens[user.id] =
      token: token
      date: (new Date).getTime()

    res.send "You can log in at #{HOST}/github/auth/#{token} in the next 5 minutes."

  robot.respond /github add ([^ ]+) to ([^ ]+)( .*)/, (res) ->
    api = apiFor robot, res.message.user

    [gitHubUsername, org, teamsString] = res.match[1..3]
    teams = teamsString.split(/,? +/)
    teamsById = {}

    if api?
      api.getOrganization(org).getTeams()
        .then (result) ->
          if result.status != 200
            robot.logger.error "Error looking up org teams for #{org}: #{JSON.stringify(result.data)}"
            throw "Failed to look up org teams for #{org}."
          else
            teams = result.data
              .filter((_) -> return teams.indexOf(_.slug) > -1)
              .map((_) -> teamsById[_.id] = _.slug; api.getTeam(_.id))

            axios.all(teams.map((_) -> _.addMembership(gitHubUsername)))
        .then(axios.spread ->
          teamStatuses = Array.prototype.slice.apply(arguments)
          [successes, failures] =
            teamStatuses.reduce(
              (([succ, fail], res) ->
                if res.status == 200
                  succ.push(res)
                else
                  fail.push(res)

                [succ, fail]),
              [[], []])
          allFailed = successes.length == 0
          pending = successes.some((_) -> _.data.state == 'pending')

          if failures.length > 0
            robot.logger.error "Got failures adding #{gitHubUsername} to #{teams.join(", ")} in #{org}: " +
              failures.map((_) -> _.data.message).join(", ") + "."

          successTeams = successes.map((_) -> teamsById[_.data.url.replace(/^.*teams\/([^/]+)\/.*$/, "$1")]).join(", ")

          switch
            when allFailed
              res.send  "Failed to add #{gitHubUsername} to any teams in #{org}."
            when pending && failures.length > 0
              res.send "Invited #{gitHubUsername} to #{successTeams} in #{org}, but the others failed."
            when pending
              res.send "Invited #{gitHubUsername} to #{successTeams} in #{org}."
            when failures.length > 0
              res.send "Added #{gitHubUsername} to #{successTeams} in #{org}, but the others failed."
            else
              res.send "Added #{gitHubUsername} to #{successTeams} in #{org}."
        )
        .catch (error) ->
          robot.logger.error "Error looking up user profile: ", error
          res.send "Error adding #{gitHubUsername} to #{org}: #{error}."
    else
      res.send "You don't seem to be authenticated with GitHub; try sending me `github auth`!"

  robot.respond /github who am (i|I)/, (res) ->
    api = apiFor robot, res.message.user

    if api?
      api.getUser().getProfile()
        .then (response) ->
          string = ""
          for key, value of response.data
            string += "#{key}: #{value}\n"

          res.send "You are:\n#{string}"
        .catch (error) ->
          robot.logger.error "Error looking up user profile: ", error
          res.send "Something went wrong looking you up :("
    else
      res.send "You don't seem to be authenticated with GitHub; try sending me `github auth`!"

  robot.router.get '/github/auth/:token', (req, res) ->
    token = req.params.token
    found = false
    for userId, pendingInfo of robot.brain.pendingGitHubTokens when token == pendingInfo.token
      pendingInfo.date = (new Date).getTime() # extend lifetime by 5 minutes
      res.send 200, "<!doctype html><html><body><form action='/github/auth/#{token}' method='post'><label>OAuth Token: <input name='oauthtoken'></label> <input type='submit'></form></body></html>"
      found = true
      break

    unless found
      res.send 404, "File Not Found."

  robot.router.post '/github/auth/:token', (req, res) ->
    token = req.params.token
    found = false
    for userId, pendingInfo of robot.brain.pendingGitHubTokens when token == pendingInfo.token
      delete robot.brain.pendingGitHubTokens[userId]
      robot.brain.gitHubTokens[userId] = req.body.oauthtoken
      res.send 200, "<!doctype html><html><body>Got it!</body></html>"
      found = true
      break

    unless found
      res.send 404, "File Not Found."
