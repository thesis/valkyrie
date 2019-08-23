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
    .messagesBot("did someone call for a badger?", 400)
    .bot.messagesRoom("Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS")
    .expect("doesn't need badgers")
})
