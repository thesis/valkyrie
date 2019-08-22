const Helper = require("hubot-test-helper")
const chai = require("chai")
const co = require("co")
const Promise = require("bluebird")

const { expect } = chai

const helper = new Helper("../scripts/example.coffee")

describe("example script", function() {
  beforeEach(function() {
    this.room = helper.createRoom()
  })

  afterEach(function() {
    this.room.destroy()
  })

  context("user mentions a badger", function() {
    beforeEach(function() {
      return co(
        function*() {
          yield this.room.user.say("alice", "did someone call for a badger?")
          yield new Promise.delay(1000)
        }.bind(this),
      )
    })

    it("doesn't need badgers", function() {
      expect(this.room.messages).to.eql([
        ["alice", "did someone call for a badger?"],
        ["heimdall", "Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS"],
      ])
    })
  })

  context("user asks about pod bay doors", function() {
    beforeEach(function() {
      return co(
        function*() {
          yield this.room.user.say("bob", "@heimdall open the pod bay doors")
          yield new Promise.delay(1000)
        }.bind(this),
      )
    })

    it("won't open the pod bay doors", function() {
      expect(this.room.messages).to.eql([
        ["bob", "@heimdall open the pod bay doors"],
        ["heimdall", "@bob I'm afraid I can't let you do that."],
      ])
    })
  })

  context("user asks about dutch doors", function() {
    beforeEach(function() {
      return co(
        function*() {
          yield this.room.user.say("bob", "@heimdall open the dutch doors")
          yield new Promise.delay(1000)
        }.bind(this),
      )
    })

    it("will open the dutch doors", function() {
      expect(this.room.messages).to.eql([
        ["bob", "@heimdall open the dutch doors"],
        ["heimdall", "@bob Opening dutch doors"],
      ])
    })
  })
})
