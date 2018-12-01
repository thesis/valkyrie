// Description:
//   Operates a Zeplin <-> Flowdock integration by scraping Zeplin as the
//   configured user.
//
// Configuration:
//   ZEPLIN_USERNAME Username to log in to Zeplin.
//   ZEPLIN_PASSWORD Password to log in to Zeplin.
//   ZEPLIN_FLOWDOCK_TOKEN Token for Flowdock integration.
//
// Commands:
//   None

import * as flowdock from '../lib/flowdock';
import * as zeplin from '../lib/zeplin';
import * as util from 'util';

require('axios-debug-log')({})

const FLOWDOCK_SESSION = new flowdock.Session(process.env['ZEPLIN_FLOWDOCK_TOKEN']),
      ZEPLIN_SESSION = new zeplin.Session(
          process.env['ZEPLIN_USERNAME'],
          process.env['ZEPLIN_PASSWORD']
      );

async function createFlowdockComment(
    creator,
    projectId,
    screenId,
    commentId,
    commentUrl,
    commentBody
) {
    return FLOWDOCK_SESSION.postDiscussion({
        uuid: `zeplin-${projectId}-${screenId}-comment-${commentId}`,
        title: `<a href="${commentUrl}">commented</a>`,
        body: commentBody,
        author: {
            name: creator.name,
            email: creator.email
        },
        external_thread_id: `zeplin-${projectId}-${screenId}`
    });
}

async function createFlowdockActivity(
    creator,
    projectId,
    screenId,
    activityId,
    activityUrl,
    activityType
) {
    return await FLOWDOCK_SESSION.postActivity(
        {
            uuid: `zeplin-${projectId}-${screenId}-activity-${activityId}`,
            title: `<a href="${activityUrl}">${activityType}</a>`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_thread_id: `zeplin-${projectId}-${screenId}`
        }
    )
}

async function createFlowdockThread(creator, project: zeplin.Project, screen: zeplin.Screen) {
    const projectLink = `<a href="${project.url}">${project.name}</a>`,
          screenLink = `<a href="${screen.url}">${screen.name}</a>`,
          snapshotUrl = await screen.snapshotUrl()

    return await FLOWDOCK_SESSION.postActivity(
        {
            uuid: `zeplin-${project.id}-${screen.id}-created`,
            title: `created screen ${screenLink}`,
            author: {
                name: creator.name,
                email: creator.email
            },
            external_url: screen.url,
            external_thread_id: `zeplin-${project.id}-${screen.id}`,
            thread: {
                title: screen.name,
                external_url: screen.url,
                body: `<img src="${snapshotUrl}">`, // + description
                fields: [
                    {label: 'project', value: projectLink},
                    {label: 'type', value: project.type}
                ]
            }
        }
    )
}

const notificationHandlers = {
    "CreateDot": async function(notification, logger) {
        const project = await ZEPLIN_SESSION.getProject(notification.params.project),
              screen = project.getScreen(
                  notification.params.screen._id,
                  notification.params.screen.name
                ),
              notifiedCommentIds = notification.events.map(e => e.comment._id),
              comments = await screen.getCommentsNewerThanOldestOf(notifiedCommentIds);

        for (let comment of comments) {
            await createFlowdockComment(
                { name: comment.creatorName, email: comment.creatorEmail },
                project.id,
                screen.id,
                comment.id,
                screen.commentUrl(comment.dotId, comment.id),
                comment.body
            );
        };
    },
    "CreateDotComment": async function(notification, logger) {
        const project = await ZEPLIN_SESSION.getProject(notification.params.project),
              screen = project.getScreen(
                  notification.params.screen._id,
                  notification.params.screen.name,
                ),
              notifiedCommentIds = notification.events.map(e => e.comment._id),
              comments = await screen.getCommentsNewerThanOldestOf(notifiedCommentIds);

        for (let comment of comments) {
            await createFlowdockComment(
                { name: comment.creatorName, email: comment.creatorEmail },
                project.id,
                screen.id,
                comment.id,
                screen.dotUrl(comment.dotId),
                comment.body
            );
        }
    },
    "ResolveDot": async function(notification, logger) {
        let project = await ZEPLIN_SESSION.getProject(notification.params.project),
            screen = project.getScreen(
                notification.params.screen._id,
                notification.params.screen.name
            );

        for (let event of notification.events) {
            // The resolver may not be the same as the author.
            let creatorName = event.source.username,
                creatorEmail = event.source.email;

            await createFlowdockActivity(
                { name: creatorName, email: creatorEmail },
                project.id,
                screen.id,
                event.dot._id,
                screen.dotUrl(event.dot._id),
                "resolved a comment"
            );
        };
    },
    // CreateScreenVersion
    // CreateComponent?
    "CreateScreen": async function(notification, logger) {
        const project = await ZEPLIN_SESSION.getProject({
                  id: notification.params.project._id,
                  name: notification.params.project.name,
                  type: notification.params.project.type
              }),
              creator = notification.params.source.username,
              creatorEmail = notification.params.source.email,
              screensById = await project.screensById();

        for (let event of notification.events) {
            let screenId = event.screen._id,
                screen = screensById[screenId];

            if (! screen) {
                return;
            }

            await createFlowdockThread(
                { name: creator, email: creatorEmail },
                project,
                screen
            )
        }
    }
}

function checkForNotifications(logger, brain) {
    return async function() {
        try {
            let lastSeen = brain.get('lastSeen');
            if (lastSeen) {
                lastSeen = new Date(lastSeen)
            } else {
                lastSeen = new Date(0)
            }

            const notifications = await ZEPLIN_SESSION.getNotifications();

            let seenNotifications = 0;
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
                        logger.error(`Error handling notification [${action}]}]: ${util.inspect(err, { depth: 4 })}`)
                    }
                }

                lastSeen = date;
                seenNotifications += 1;
                brain.set('lastSeen', lastSeen.toISOString());
            };

            logger.info(
                "Saw %s notifications; read through %s",
                seenNotifications,
                lastSeen.toISOString()
            )
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
  