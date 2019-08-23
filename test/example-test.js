"use strict"
const HubotChatTesting = require("hubot-chat-testing")
const Helper = require("hubot-test-helper")

const chat = new HubotChatTesting(
  "hubot",
  new Helper("../scripts/example.coffee"),
)

const expect = require("chai").expect

describe("Testing example scripts", function() {
  chat
    .when("user mentions a badger", { answerDelay: 200 })
    .user("alice")
    .messagesRoom("did someone call for a badger?", 400)
    .bot.messagesRoom("Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS")
    .expect("doesn't need badgers")

  chat
    .when("user asks about pod bay doors", { answerDelay: 200 })
    .user("bob")
    .messagesBot("open the pod bay doors", 400)
    // Note: repliesWith will prepend "@<username> ": don't include in expected output
    .bot.repliesWith("I'm afraid I can't let you do that.")
    .expect("won't open the pod bay doors")

  chat
    .when("user asks about dutch doors", { answerDelay: 200 })
    .user("hal")
    .messagesBot("open the dutch doors", 400)
    // Alternately, messagesRoom WITH "@<username> " in expected output works
    .bot.messagesRoom("@hal Opening dutch doors")
    .expect("will open the dutch doors")
})
