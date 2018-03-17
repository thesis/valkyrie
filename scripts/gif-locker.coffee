# Description:
#   Store and retrieve your favorite gif urls
#
# Dependencies:
#   Nope
#
# Configuration:
#   Nope
# Commands:
#   hubot gif {gif-name} - Display random gif url from given name.
#   <gif-name>.gif - Display random gif url from given name. Will not show error message if no gif found.
#   hubot (store|add) {gif-name} {gif-url} - Store gif url with given name.
#   hubot alias gif {gif-name} {other-gif-name} - Store gif-name so that it will always point to the gifs in other-gif-name.
#   hubot remove gif alias {gif-name} - Removes gif-name as an alias.
#   hubot remove all {gif-name} - Remove all gifs with given name.
#   hubot remove gif {gif-name} {gif-url} - Remove specific gif url with given name.
#   hubot list gifs {gif-name} - Display gif urls from given name.
#   hubot list gifs - Display gif names stored.
# 
# Author: 
#   @riveramj

GIF_LOCKER = 'gifLocker'

module.exports = (robot) ->
  getGifs = () ->
    gifLocker = robot.brain.get(GIF_LOCKER) || {}

    gifLocker.gifs || {}

  getGifsNamed = (name) ->
    gifs = getGifs()

    # Look up gif, replace it with an alias if needed, recursively.
    namedGifs = gifs[name]
    while namedGifs?.alias?
      namedGifs = gifs[namedGifs.alias]

    # Make sure we have an array to work with.
    namedGifs || []

  updatingGifs = (callback) ->
    gifLocker = robot.brain.get(GIF_LOCKER) || {}
    gifs = gifLocker.gifs || {}

    updatedGifs = callback(gifs)

    # Make sure no one accidentally overwrites the gifs with something totally
    # busted.
    if updatedGifs? && typeof updatedGifs == 'object'
      gifLocker.gifs = updatedGifs
      robot.brain.set('gifLocker', gifLocker)

  migrateURLData = (gifSet) ->
    gifLocker = robot.brain.get('gifLocker')
    migrated = gifLocker?.migrated || false

    if !migrated
      allGifs = gifLocker?.gifs || {}
      uniqueGifNames = []
      newGifs = {}
    
      for gif in allGifs
        name = gif.name.toLowerCase()
        gifSet = allGifs.filter (gif) -> gif.name.toLowerCase() == name
        for gif in gifSet
          newGifs[name] ||= []
          if newGifs[name].indexOf(gif.url) == -1
            newGifs[name].push gif.url

      gifLocker?.gifs = newGifs
      gifLocker?.migrated = true
    
      robot.brain.set 'gifLocker', gifLocker

  setTimeout ->
    migrateURLData ->
  , 4 * 1000

  storeGif = (msg) ->
    gifName = msg.match[1].trim().toLowerCase()
    gifUrl = msg.match[2].trim()

    updatingGifs (gifs) ->
      if gifs[gifName]?.alias?
        msg.send "#{gifName} is an alias for #{gifs[gifName].alias}; try updating the original!"
      else
        gifs[gifName] ||= []
        gifs[gifName].push gifUrl

        message =
          switch gifs[gifName].length
            when 1
              "one entry for that name"
            else
              "#{gifs[gifName].length} entries for that name"

        msg.send "#{gifName}. Got it; #{message}."

      gifs

  setAlias = (msg) ->
    aliasName = msg.match[1].trim().toLowerCase()
    aliasTarget = msg.match[2].trim().toLowerCase()

    updatingGifs (gifs) ->
      if gifs[aliasName]? && gifs[aliasName] instanceof Array
        msg.send "That name already has gifs under it, so it can't be used as an alias!"
      else if gifs[aliasName]?
        gifs[aliasName] = alias: aliasTarget
        msg.send "Changed the alias from #{gifs[aliasName]} to #{aliasTarget}."
      else
        gifs[aliasName] = alias: aliasTarget
        msg.send "All set, #{aliasName} points to #{aliasTarget}!"

      gifs

  removeAlias = (msg) ->
    aliasName = msg.match[1].trim().toLowerCase()

    updatingGifs (gifs) ->
      if gifs[aliasName]? && ! gifs[aliasName].alias
        msg.send "That's not an alias!"
      else if gifs[aliasName]?
        delete gifs[aliasName]
        msg.send "Deleted alias #{aliasName}."
      else
        msg.send "No alias named #{aliasName} to delete!"

      gifs

  showGif = (msg, showNoGifMessage = true) ->
    gifName = msg.match[1].trim().toLowerCase()

    gifs = getGifsNamed(gifName)
    if gifs.length > 0
      gifUrl = gifs[Math.floor(Math.random()*gifs.length)]
      msg.send gifUrl
    else
      if showNoGifMessage
        msg.send "Did not find any cool gifs for #{gifName}. You should add some!"

  listGifs = (msg) ->
    gifName = msg.match[1].trim().toLowerCase()

    gifs = getGifsNamed(gifName)
    msg.send gifs.join(", ")

  listAllGifs = (msg) ->
    names = Object.keys getGifs()

    names = names.sort().toString().replace(/,/g, "\n")

    msg.send names

  removeGifsByName = (msg) ->
    gifName = msg.match[1].trim().toLowerCase()

    updatingGifs (gifs) ->
      original = gifs[gifName]
      delete gifs[gifName]

      if original?.alias?
        msg.send "Removed #{gifName} alias for #{original.alias}."
      else
        msg.send "Removed all URLs for #{gifName}."

      gifs

  removeGifsByNameUrl = (msg) ->
    gifName = msg.match[1].trim().toLowerCase()
    gifUrl = msg.match[2].trim()

    updatingGifs (gifs) ->
      namedGifs = gifs[gifName]

      if namedGifs.alias?
        msg.send "#{gifName} is an alias for #{namedGifs.alias}; please update the original."
      else
        namedGifs = namedGifs.filter((_) -> _ != gifUrl)

        message =
          if namedGifs.length == 0
            delete gifs[gifName]
            "no URLs left for that name"
          else
            gifs[gifName] = namedGifs
            switch namedGifs.length
              when 1
                "1 URL left for that name"
              else
                "#{namedGifs.length} URLs left for that name"

        msg.send "Removed #{gifUrl} from #{gifName}; #{message}."

      gifs

  robot.respond /(?:store|add) (.+) (.+)/i, (msg) ->
    storeGif(msg)

  robot.respond /gif (.+)/i, (msg) ->
    showGif(msg)

  robot.respond /alias gif (.+) (.+)/i, (msg) ->
    setAlias(msg)

  robot.respond /remove gif alias (.+)/, (msg) ->
     removeAlias(msg)

  robot.hear ///^(?!#{robot.name})(.+)\.gif$///i, (msg) ->
    showGif(msg, false)

  robot.respond /list gifs (.+)/i, (msg) ->
    listGifs(msg)

  robot.respond /list gifs$/i, (msg) ->
    listAllGifs(msg)

  robot.respond /remove all (.+)/i, (msg) ->
    removeGifsByName(msg)

  robot.respond /remove gif (.+) (.+)/i, (msg) ->
    if msg.match[1].trim().toLowerCase() != 'alias'
      removeGifsByNameUrl(msg)
