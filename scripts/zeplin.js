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
      cookie = require('cookie'),
      flowdock = require('../lib/flowdock');

let loginToken = null,
    apiHeaders = null,
    htmlHeaders = null;

const FLOWDOCK_SESSION = new flowdock.Session(process.env['ZEPLIN_FLOWDOCK_TOKEN']);

const ZEPLIN_URLS = {
    login: "https://app.zeplin.io/login",
    loginApi: "https://api.zeplin.io/users/login",
    projects: "https://app.zeplin.io/projects",
    notifications: "https://api.zeplin.io/notifications?count=10",
    notificationMarker: "https://api.zeplin.io/users/notificationLastReadTime",
    project: "https://app.zeplin.io/project/{projectId}",
    apiProject: "https://api.zeplin.io/projects/{projectId}",
    projectDashboard: "https://app.zeplin.io/project/{projectId}/dashboard",
    screen: "https://app.zeplin.io/project/{projectId}/screen/{screenId}",
    sizedImage: "https://img.zeplin.io/{snapshotUrl}?w={width}&cropTop=0&cropLeft=0&cropWidth={width}&cropHeight={height}"
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

function createFlowdockActivity(
    logger,
    creator,
    projectId,
    screenId,
    activityId,
    activityUrl,
    activityType
) {
    FLOWDOCK_SESSION.postDiscussion(
        {
            uuid: `zeplin-${projectId}-${screenId}-activity-${activityId}`,
            title: `<a href="${activityUrl}">${activityType}</a>`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_thread_id: `zeplin-${projectId}-${screenId}`
        }
    ).catch((reason) => {
        logger.error(JSON.stringify(reason))
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
    screenUrl,
    screenWidth,
    screenHeight
) {
    let projectUrl =
        ZEPLIN_URLS.project
            .replace(/{projectId}/, projectId)
    let projectLink = `<a href="${projectUrl}">${projectName}</a>`

    let screenLink = `<a href="${screenUrl}">${screenName}</a>`

    let screenSrc =
        ZEPLIN_URLS.sizedImage
            .replace(/{snapshotUrl}/, encodeURIComponent(screenUrl))
            .replace(/{width}/g, screenWidth)
            .replace(/{height}/g, screenHeight);

    FLOWDOCK_SESSION.postActivity(
        {
            uuid: `zeplin-${projectId}-${screenId}-created`,
            title: `created screen ${screenLink}`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_url: screenUrl,
            external_thread_id: `zeplin-${projectId}-${screenId}`,
            thread: {
                title: screenName,
                external_url: screenUrl,
                body: `<img src="${screenSrc}">`, // + description
                fields: [
                    {label: 'project', value: projectLink},
                    {label: 'type', value: projectType}
                ]
            }
        }
    ).catch((reason) => {
        logger.error(JSON.stringify(reason))
    })
}

// Returns an array tuple with an array of comments and a map of comment ids to
// comments.P
function commentsForScreenPromise(projectId, screenId) {
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

            let comments = dots.reduce((comments, dot) => {
                return dot.comments.reduce((comments, dotComment) => {
                    let comment = {
                        id: dotComment._id,
                        dotId: dot._id,
                        body: dotComment.note,
                        date: new Date(dotComment.created),
                        creatorName: dotComment.author.username,
                        creatorEmail: dotComment.author.email
                    }

                    comments.push(comment);

                    return comments;
                }, comments);
            }, []);

            // Chronologically oldest to newest.
            comments.sort((a, b) => a.date - b.date);

            return comments;
        });
}

function filterForOldest(commentIds) {
    return function(comments) {
        let idSet = new Set(commentIds),
            oldestCommentIndex = comments.findIndex((comment) => idSet.has(comment.id))

        if (oldestCommentIndex == -1) {
            return [];
        } else {
            return comments.slice(oldestCommentIndex);
        }
    }
}

const notificationHandlers = {
    "CreateDot": async function(notification, logger) {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id;

        commentsForScreenPromise(projectId, screenId)
            .then(filterForOldest(notification.events.map(e => e.comment._id)))
            .then(async function(comments) {
                for (let comment of comments) {
                    await createFlowdockActivity(
                        logger,
                        { name: comment.creatorName, email: comment.creatorEmail },
                        projectId,
                        screenId,
                        comment.id,
                        zeplinCommentUrl(
                            projectId,
                            screenId,
                            comment.dotId,
                            comment.id
                        ),
                        comment.body
                    );
                };
            });
    },
    "CreateDotComment": async function(notification, logger) {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id,
            dotId = notification.params.dot._id;

        // Fetch intermediate unmentioned comments?
        commentsForScreenPromise(projectId, screenId)
            .then(filterForOldest(notification.events.map(e => e.comment._id)))
            .then(async function(comments) {
               for (let comment of comments) {
                    await createFlowdockActivity(
                        logger,
                        { name: comment.creatorName, email: comment.creatorEmail },
                        projectId,
                        screenId,
                        comment.id,
                        zeplinCommentUrl(
                            projectId,
                            screenId,
                            dotId,
                            comment.id
                        ),
                        comment.body
                    );
                };
            });
    },
    "ResolveDot": async function(notification, logger) {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id;

        for (let event of notification.events) {
            // The resolver may not be the same as the author.
            let creatorName = event.source.username,
                creatorEmail = event.source.email;

            await createFlowdockActivity(
                logger,
                { name: creatorName, email: creatorEmail },
                projectId,
                screenId,
                zeplinCommentUrl(projectId, screenId, event.dot._id),
                "resolved a comment"
            );
        };

        new Promise(() => 0)
    },
    // CreateScreenVersion
    // CreateComponent?
    "CreateScreen": async function(notification, logger) {
        let projectId = notification.params.project._id,
            projectName = notification.params.project.name,
            projectType = notification.params.project.type,
            creator = notification.params.source.username,
            creatorEmail = notification.params.source.email;

        let apiProjectUrl =
            ZEPLIN_URLS.apiProject
                .replace(/{projectId}/, projectId);

        const result = await axios(apiProjectUrl, apiHeaders);

        let screens = result.data.screens;
        let screensById = screens.reduce((screensById, screen) => {
            screensById[screen._id] = screen;
            return screensById
        }, {})

        for (let event of notification.events) {
            let screenId = event.screen._id,
                screenName = event.screen.name,
                screen = screensById[screenId];

            if (! screen) {
                return;
            }

            let snapshot = screen.latestVersion.snapshot;

            await createFlowdockThread(
                logger,
                { name: creator, email: creatorEmail },
                projectId,
                projectName,
                projectType,
                screenId,
                screenName,
                snapshot.url,
                snapshot.width,
                snapshot.height
            );
        }
    }
}

function checkForNotifications(logger, brain) {
    return async function() {
        if (! loginToken) {
            logIn(logger).then(checkForNotifications(logger, brain));
        } else {
            let lastSeen = brain.get('lastSeen');
                lastSeen = new Date(lastSeen)
            if (lastSeen) {
            } else {
                lastSeen = new Date(0)
            }
                lastSeen = new Date(0)

            axios
                .get(ZEPLIN_URLS.notifications, apiHeaders)
                .then(async function(result) {
                    if (result.status != 200) {
                        logger.error('Failed to get Zeplin projects page: ', result.statusText, result);
                    } else {
                        let notifications = result.data.notifications;

                        for (let notification of notifications.reverse()) {
                            let date = new Date(notification.updated)
                            if (date <= lastSeen) {
                               return;
                            }

                            let action = notification.actionName;
                            let notificationHandler = notificationHandlers[action];
                            if (typeof notificationHandler == "function") {
                                var result = notificationHandler(notification, logger)
                                if (result && typeof result.catch == "function") {
                                    await result.catch(err => {
                                        logger.error("Error handling notification: ", err)
                                    });
                                }
                            }

                            lastSeen = date;
                            brain.set('lastSeen', lastSeen.toISOString());
                        };
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
  