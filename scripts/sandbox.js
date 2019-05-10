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
    dadJokeUrl = 'https://icanhazdadjoke.com',
    decode = require('decode-html'),
    requestHeaders = {
        'User-Agent': 'Heimdall Hubot https://github.com/thesis-heimdall',
        'Accept': 'application/json'
    };

module.exports = (robot) => {
    robot.hear(/dad/i, {
        id: 'dad-jokes'
    }, (res) => {

        new Promise((resolve, reject) =>
                robot.http(dadJokeUrl)
                .headers(requestHeaders)
                .get()((err, response, body) =>
                    err ? reject(err) : resolve(body)
                )
            )
            .then(body => JSON.parse(body))
            .then(json => decode(json.joke))
            .then(joke => res.send('Dad jokes? I got dad jokes! ', joke))
            .catch(err => res.send('Looks like Dad borked the internet: ', err))
    })
}
