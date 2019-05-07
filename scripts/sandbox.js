// Description:
//   A place to play with new listeners and things
//
//   First up: dad-jokes. Because everyone loves a dad joke
//   Thanks to this handy blog:
//   https://keestalkstech.com/2018/01/hubot-es6-promises/
//   and https://icanhazdadjoke.com/api
//
// Configuration:
//
//
// Commands:
//   None
//
// Author:
//   kb0rg

const
    dadJokeUrl = 'https://icanhazdadjoke.com/api',
    decode = require('decode-html');

module.exports = (robot) => {
  robot.hear(/dad/i, (res) => {

    new Promise((resolve, reject) =>
        robot.http(dadJokeUrl).get()((err, response, body) =>
            err ? reject(err) : resolve(body)
            )
        )
    .then(body => JSON.parse(body))
    .then(json => decode(json.value.joke))
    .then(joke => res.reply(joke))
    .catch(err => res.reply('Dad broke the internet: ' + err))
  })
}

