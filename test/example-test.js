/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const Helper = require("hubot-test-helper")
const chai = require("chai")

const { expect } = chai

const helper = new Helper("../scripts/example.coffee")

describe("example script", function() {
  beforeEach(function() {
    return (this.room = helper.createRoom())
  })

  afterEach(function() {
    return this.room.destroy()
  })

  it("doesn't need badgers", function() {
    return this.room.user
      .say("alice", "did someone call for a badger?")
      .then(() => {
        return expect(this.room.messages).to.eql([
          ["alice", "did someone call for a badger?"],
          ["hubot", "Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS"],
        ])
      })
  })

  it("won't open the pod bay doors", function() {
    return this.room.user
      .say("bob", "@hubot open the pod bay doors")
      .then(() => {
        return expect(this.room.messages).to.eql([
          ["bob", "@hubot open the pod bay doors"],
          ["hubot", "@bob I'm afraid I can't let you do that."],
        ])
      })
  })

  return it("will open the dutch doors", function() {
    return this.room.user.say("bob", "@hubot open the dutch doors").then(() => {
      return expect(this.room.messages).to.eql([
        ["bob", "@hubot open the dutch doors"],
        ["hubot", "@bob Opening dutch doors"],
      ])
    })
  })
})
