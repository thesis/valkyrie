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
#   hubot github auth - returns a URL where you can identify your GitHub self
#     to the hubot. Upon identification, if a pending addition request exists
#     from a call to `github add user`, it will be executed.
#   hubot github add [developer|user] <username> to [cardforcoin|keep-network] -
#     Adds the given GitHub username to the specified team with the given role. The
#     username is a *chat* username, and that user must already have logged in using
#     `github auth` to prove they own that username. If the user has not, the
#     request to add them will be stored until they have.
GitHubApi = require 'github-api'
UUIDV4 = require 'uuid/v4'

CLIENT_CACHE = {}
HOST = process.env['HUBOT_HOST']

apiFor = (bot, user) ->
  api = CLIENT_CACHE[user]
  unless api?
    token = bot.brain.gitHubTokens[user.id]
    if token
      api = new GitHubApi token: token

  api

module.exports = (robot) ->
  robot.brain.pendingGitHubTokens ||= {}
  robot.brain.gitHubTokens ||= {}

  robot.respond /github auth/, (res) ->
    user = res.message.user
    token = UUIDV4()

    robot.brain.pendingGitHubTokens ||= {}
    robot.brain.pendingGitHubTokens[user.id] =
      token: token
      date: (new Date).getTime()

    res.send "You can log in at #{HOST}/github/auth/#{token}"

  robot.respond /github add (developer|user) ([^ ]+) to (cardforcoin|keep-network)/, (res) ->
    api = apiFor robot, res.message.user

    [role, gitHubUsername, org] = match[1..3] 

    teamId = 'everyone'

    if api?
      api.getTeam(teamId).addMembership(gitHubUsername)
        .then (resut) ->
          switch result.state
            when 'active'
              res.send "Added #{gitHubUsername} to #{org}."
            when 'pending'
              res.send "Invited #{gitHubUsername} to #{org}."
            else
              res.send "Unexpected state adding #{gitHubUsername} to #{org}: #{result.state}."
        .catch (error) ->
          res.send "Error adding #{gitHubUsername} to #{org}: #{error}."
    else
      res.send "You don't seem to be authenticated with GitHub; try sending me `github auth`!"

  robot.router.get '/github/auth/:token', (req, res) ->
    token = req.params.token
    found = false
    for userId, pendingInfo of robot.brain.pendingGitHubTokens when token == pendingInfo.token
      res.send 200, "<!doctype html><html><body><form target='/github/auth/#{token}' type='post'><label>OAuth Token: <input name='oauthtoken'</label></form></body></html>"
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
