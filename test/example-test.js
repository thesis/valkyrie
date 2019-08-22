const HubotChatTesting = require("hubot-chat-testing")
const Helper = require("hubot-test-helper")

const chat = new HubotChatTesting(
  "hubot",
  new Helper("../scripts/example.coffee"),
)

describe("example script", function() {
  beforeEach(function() {
    this.room = helper.createRoom()
  })

  afterEach(function() {
    this.room.destroy()
  })

  chat
    .when("user mentions a badger")
    .user("alice")
    .messagesBot("did someone call for a badger?")
    .bot.messagesRoom("Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS")
    .expect("doesn't need badgers")
})
