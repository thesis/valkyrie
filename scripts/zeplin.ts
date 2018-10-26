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

const axios = require('axios'),
      _ = require('axios-debug-log')({}),
      flowdock = require('../lib/flowdock'),
      zeplin = require('../lib/zeplin'),
      util = require('util');

let loginToken = null,
    apiHeaders = null,
    htmlHeaders = null;

const FLOWDOCK_SESSION = new flowdock.Session(process.env['ZEPLIN_FLOWDOCK_TOKEN']),
      ZEPLIN_SESSION = new zeplin.Session(
          process.env['ZEPLIN_USERNAME'],
          process.env['ZEPLIN_PASSWORD']
      );

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

function createFlowdockComment(
    logger,
    creator,
    projectId,
    screenId,
    commentId,
    commentUrl,
    commentBody
) {
    return FLOWDOCK_SESSION.postDiscussion(
        {
            uuid: `zeplin-${projectId}-${screenId}-comment-${commentId}`,
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
    activityId,
    activityUrl,
    activityType
) {
    return FLOWDOCK_SESSION.postActivity(
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
        logger.error(util.inspect(reason, { depth: 50 }))
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

    return FLOWDOCK_SESSION.postActivity(
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

const notificationHandlers = {
    "CreateDot": async function(notification, logger) {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id,
            comments = await commentsForScreenPromise(projectId, screenId),
            filteredComments = filterForOldest(notification.events.map(e => e.comment._id), comments);

        for (let comment of filteredComments) {
            await createFlowdockComment(
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
    },
    "CreateDotComment": async function(notification, logger) {
        let projectId = notification.params.project._id,
            screenId = notification.params.screen._id,
            dotId = notification.params.dot._id,
            comments = await commentsForScreenPromise(projectId, screenId),
            filteredComments = filterForOldest(notification.events.map(e => e.comment._id), comments);

        for (let comment of filteredComments) {
            console.log("COMMENT")
            await createFlowdockComment(
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
                event.dot._id,
                zeplinCommentUrl(projectId, screenId, event.dot._id),
                "resolved a comment"
            );
        };
    },
    // CreateScreenVersion
    // CreateComponent?
    "CreateScreen": async function(notification, logger) {
        let projectId = notification.params.project._id,
            projectName = notification.params.project.name,
            projectType = notification.params.project.type,
            creator = notification.params.source.username,
            creatorEmail = notification.params.source.email;

        const screensById = ZEPLIN_SESSION.getProject(projectId).screensById()

        for (let event of notification.events) {
            console.log("SCREEN")
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
        try {
            let lastSeen = brain.get('lastSeen');
                lastSeen = new Date(lastSeen)
            if (lastSeen) {
            } else {
                lastSeen = new Date(0)
            }
                lastSeen = new Date(0)

            const notifications = ZEPLIN_SESSION.getNotifications();

            for (const notification of notifications.reverse()) {
                let date = new Date(notification.updated)
                if (date <= lastSeen) {
                    return;
                }

                let action = notification.actionName;
                let notificationHandler = notificationHandlers[action];
                if (typeof notificationHandler == "function") {
                    try {
                        await notificationHandler(notification, logger)
                    } catch (err) {
                        logger.error("Error handling notification: ", err)
                    }
                }

                lastSeen = date;
                brain.set('lastSeen', lastSeen.toISOString());
            };

            // Update our last-read notification time for everyone's
            // sake...
            await ZEPLIN_SESSION.updateNotificationMarker()
        } catch(err) {
            logger.error('Failed to check for Zeplin notifications: ', err);
        };
    }
}

module.exports = function(robot) {
    let SECONDS = 1000,
        MINUTES = 60 * SECONDS,
        MINUTE = MINUTES;

    checkForNotifications(robot.logger, robot.brain)();
    setInterval(checkForNotifications(robot.logger, robot.brain), 1 * MINUTE);
  }
  