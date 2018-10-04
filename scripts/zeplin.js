'use strict'

// Description:
//   Operates a Zeplin <-> Flowdock integration by scraping Zeplin as the
//   Heimdall user.
//
// Configuration:
//   ZEPLIN_USERNAME Username to log in to Zeplin.
//   ZEPLIN_PASSWORD Password to log in to Zeplin.
//   ZEPLIN_FLOWDOCK_TOKEN Token for Flowdock integration.
//
// Commands:
//   None

const querystring = require('querystring'),
      cheerio = require('cheerio'),
      axios = require('axios'),
      _ = require('axios-debug-log')({}),
      cookie = require('cookie');

let loginToken = null,
    apiHeaders = null,
    htmlHeaders = null;

const ZEPLIN_URLS = {
    login: "https://app.zeplin.io/login",
    loginApi: "https://api.zeplin.io/users/login",
    projects: "https://app.zeplin.io/projects",
    notifications: "https://api.zeplin.io/notifications?count=10",
    notificationMarker: "https://api.zeplin.io/users/notificationLastReadTime",
    project: "https://app.zeplin.io/project/{projectId}",
    apiProject: "https://api.zeplin.io/projects/{projectId}",
    projectDashboard: "https://app.zeplin.io/project/{projectId}/dashboard",
    screen: "https://app.zeplin.io/project/{projectId}/screen/{screenId}"
};

const FLOWDOCK_URLS = {
    messages: `https://api.flowdock.com/messages`
};

function logIn(logger) {
    return axios.get(ZEPLIN_URLS.login)
        .then(login => {
            if (login.status != 200) {
                logger.error('Failed to log in to Zeplin: ', login.statusText, login);
            } else {
                let $loginPage = cheerio.load(login.data);

                let formTarget = $loginPage('#loginForm').attr('target') || ZEPLIN_URLS.login;
                let usernameField = $loginPage('#handle').attr('name');
                let passwordField = $loginPage('#password').attr('name');
                let loginParams = {};
                loginParams[usernameField] = process.env['ZEPLIN_USERNAME'];
                loginParams[passwordField] = process.env['ZEPLIN_PASSWORD'];

                return axios.post(
                    ZEPLIN_URLS.loginApi,
                    JSON.stringify(loginParams),
                    {
                        headers: {
                            "Content-Type": "application/json"
                        },
                    }
                );
            }
        })
        .then(loginResult => {
            if (loginResult.status != 200) {
                logger.error('Failed to log in to Zeplin: ', loginResult.statusText, loginResult);
            } else {
                loginToken = loginResult.data.token;
                apiHeaders = { headers: { 'zeplin-token': loginToken } };
                htmlHeaders = {
                    headers: {
                        'Cookie': cookie.serialize('userToken', loginToken)
                    }
                };
            }
        })
        .catch(err => {
            logger.error('Failed to log in to Zeplin: ', err);
        })
}

function zeplinCommentUrl(projectId, screenId, dotId, commentId) {
    let screenUrl =
        ZEPLIN_URLS.screen
            .replace(/{projectId}/, projectId)
            .replace(/{screenId}/, screenId);

    let queryParams = {
        did: dotId,
        cmid: commentId
    };

    return screenUrl + `?${querystring.stringify(queryParams)}`
}

function createFlowdockComment(
    logger,
    creator,
    projectId,
    screenId,
    commentUrl,
    commentBody
) {
    axios.post(
        FLOWDOCK_URLS.messages,
        {
            flow_token: process.env['ZEPLIN_FLOWDOCK_TOKEN'],
            event: 'discussion',
            title: `<a href="${commentUrl}">commented</a>`,
            body: commentBody,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_thread_id: `zeplin-${projectId}-${screenId}`
        }
    )
    .catch(err => {
        logger.error('Failed to create Flowdock comment: ', err);
    })
}

function createFlowdockActivity(
    logger,
    creator,
    projectId,
    screenId,
    activityUrl,
    activityType
) {
    axios.post(
        FLOWDOCK_URLS.messages,
        {
            flow_token: process.env['ZEPLIN_FLOWDOCK_TOKEN'],
            event: 'activity',
            title: `<a href="${activityUrl}">${activityType}</a>`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_thread_id: `zeplin-${projectId}-${screenId}`
        }
    )
    .catch(err => {
        logger.error('Failed to create Flowdock activity: ', err);
    })
}

function createFlowdockThread(
    logger,
    creator,
    projectId,
    projectName,
    projectType,
    screenId,
    screenName,
    screenSrc
) {
    let projectUrl =
        ZEPLIN_URLS.project
            .replace(/{projectId}/, projectId)
    let projectLink = `<a href="${projectUrl}">${projectName}</a>`

    let screenUrl =
        ZEPLIN_URLS.screen
            .replace(/{projectId}/, projectId)
            .replace(/{screenId}/, screenId);
    let screenLink = `<a href="${screenUrl}">${screenName}</a>`

    axios.post(
        FLOWDOCK_URLS.messages,
        {
            flow_token: process.env['ZEPLIN_FLOWDOCK_TOKEN'],
            event: 'activity',
            title: `created screen ${screenLink}`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_url: screenUrl,
            external_thread_id: `zeplin-${projectId}-${screenId}`,
            thread: {
                title: screenName,
                body: `<img src="${screenSrc}">`, // + description
                fields: [
                    {label: 'project', value: projectLink},
                    {label: 'type', value: projectType}
                    // web url
                    // app url
                ]
            }
        }
    )
    .catch(err => {
        logger.error('Failed to create Flowdock thread: ', err);
    })
}

function commentsByIdForScreenPromise(projectId, screenId) {
    let screenUrl =
        ZEPLIN_URLS.screen
            .replace(/{projectId}/, projectId)
            .replace(/{screenId}/, screenId);

    return axios.get(screenUrl, htmlHeaders)
        .then(result => {
            let $page = cheerio.load(result.data);

            // Extract API data, unescape it via JSON.parse, then parse
            // the actual JSON.
            let regexp = /.*window.Zeplin\["apiData"\] = JSON.parse\("(.*)"\);/
            let apiData = JSON.parse(`"${regexp.exec(result.data)[1].replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1")}"`);
            let dots = JSON.parse(apiData).dots.dots;

            return dots.reduce((commentsById, dot) => {
                dot.comments.forEach(comment => {
                    commentsById[comment._id] = {
                        body: comment.note,
                        date: comment.created,
                        creatorName: comment.author.username,
                        creatorEmail: comment.author.email
                    };
                });
                return commentsById
            }, {});
        })
        .catch(err => {
            logger.error('Failed to read screen comments: ', err);
        });
}

const notificationHandlers = {
    "CreateDot": (notification, logger) => {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id;

        commentsByIdForScreenPromise(projectId, screenId)
            .then(commentsById => {
                notification.events.forEach(event => {
                    let comment = commentsById[event.comment._id];

                    if (comment) {
                        createFlowdockComment(
                            logger,
                            { name: comment.creatorName, email: comment.creatorEmail },
                            projectId,
                            screenId,
                            zeplinCommentUrl(
                                projectId,
                                screenId,
                                event.dot._id,
                                event.comment._id
                            ),
                            comment.body
                        );
                    }
                });
            });
    },
    "CreateDotComment": (notification, logger) => {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id,
            dotId = notification.params.dot._id;

        commentsByIdForScreenPromise(projectId, screenId)
            .then(commentsById => {
                notification.events.forEach(event => {
                    let comment = commentsById[event.comment._id];

                    if (comment) {
                        createFlowdockComment(
                            logger,
                            { name: comment.creatorName, email: comment.creatorEmail },
                            projectId,
                            screenId,
                            zeplinCommentUrl(
                                projectId,
                                screenId,
                                dotId,
                                event.comment._id
                            ),
                            comment.body
                        );
                    }
                });
            });
    },
    "ResolveDot": (notification, logger) => {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id;

        notification.events.forEach(event => {
            // The resolver may not be the same as the author.
            let creatorName = event.source.username,
                creatorEmail = event.source.email;

            createFlowdockActivity(
                logger,
                { name: creatorName, email: creatorEmail },
                projectId,
                screenId,
                zeplinCommentUrl(projectId, screenId, event.dot._id),
                "resolved a comment"
            );
        });
    },
    // CreateScreenVersion
    // CreateComponent?
    "CreateScreen": async (notification, logger) => {
        let projectId = notification.params.project._id,
            projectName = notification.params.project.name,
            projectType = notification.params.project.type,
            creator = notification.params.source.username,
            creatorEmail = notification.params.source.email;

        let apiProjectUrl =
            ZEPLIN_URLS.apiProject
                .replace(/{projectId}/, projectId);

        const result = await axios(apiProjectUrl, htmlHeaders);

        let screens = result.data.screens;
        let screensById = screens.reduce((screensById, screen) => {
            screensById[screen._id] = screen;
            return screensById
        }, {})

        notification.events.forEach(event => {
            let screenId = event.screen._id,
                screenName = event.screen.name,
                screenSrc = screensById[screenId].latestVersion.snapshot.url;

            createFlowdockThread(
                logger,
                { name: creator, email: creatorEmail },
                projectId,
                projectName,
                projectType,
                screenId,
                screenName,
                screenSrc
            );
        })
    }
}

function checkForNotifications(logger, brain) {
    return function() {
        if (! loginToken) {
            logIn(logger).then(checkForNotifications(logger, brain));
        } else {
            let lastSeen = brain.get('lastSeen');
            if (lastSeen) {
                lastSeen = new Date(lastSeen)
            } else {
                lastSeen = new Date(0)
            }

            axios
                .get(ZEPLIN_URLS.notifications, apiHeaders)
                .then(result => {
                    if (result.status != 200) {
                        logger.error('Failed to get Zeplin projects page: ', result.statusText, result);
                    } else {
                        let notifications = result.data.notifications;

                        notifications.reverse().forEach(notification => {
                            let date = new Date(notification.updated)
                            if (date <= lastSeen) {
                                return;
                            }

                            let action = notification.actionName;
                            let notificationHandler = notificationHandlers[action];
                            if (typeof notificationHandler == "function") {
                                notificationHandler(notification, logger);
                            }

                            lastSeen = date;
                            brain.set('lastSeen', lastSeen.toISOString());
                        });
                    }
                })
                .then(_ => {
                    // Update our last-read notification time for everyone's
                    // sake...
                    return axios.put(ZEPLIN_URLS.notificationMarker, null, apiHeaders);
                })
                .catch(err => {
                    logger.error('Failed to check for Zeplin notifications: ', err);
                });
        }
    }
}

module.exports = function(robot) {
    let SECONDS = 1000,
        MINUTES = 60 * SECONDS,
        MINUTE = MINUTES;

    checkForNotifications(robot.logger, robot.brain)();
    setInterval(checkForNotifications(robot.logger, robot.brain), 1 * MINUTE);
  }
  