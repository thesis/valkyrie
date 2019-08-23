"use strict"
const HubotChatTesting = require("hubot-chat-testing")
const Helper = require("hubot-test-helper")

const chat = new HubotChatTesting(
  "hubot",
  new Helper("../scripts/example.coffee"),
)

const expect = require("chai").expect

describe("example script", function() {
  chat
    .when("user mentions a badger", { answerDelay: 200 })
    .user("alice")
    .messagesRoom("did someone call for a badger?", 400)
    .bot.repliesWith("Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS")
    .expect("doesn't need badgers")
})
