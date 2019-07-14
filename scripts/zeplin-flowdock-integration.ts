// Description:
//   Operates a Zeplin <-> Flowdock integration by scraping Zeplin as the
//   configured user.
//
// Configuration:
//   RELEASE_NOTIFICATION_ROOM - Id of the room for release notifications.
//   ZEPLIN_USERNAME Username to log in to Zeplin.
//   ZEPLIN_PASSWORD Password to log in to Zeplin.
//   ZEPLIN_FLOWDOCK_TOKEN Token for Flowdock integration.
//
// Commands:
//   hubot zeplin last seen <datetime string> - Sets the lastSeen key in hubot's brain to the new date

import * as config from "../lib/config"
import * as flowdock from "../lib/flowdock"
import * as zeplin from "../lib/zeplin"
import * as util from "util"

require("axios-debug-log")({})

const FLOWDOCK_SESSION = new flowdock.Session(
    process.env["ZEPLIN_FLOWDOCK_TOKEN"],
  ),
  ZEPLIN_SESSION = new zeplin.Session(
    process.env["ZEPLIN_USERNAME"],
    process.env["ZEPLIN_PASSWORD"],
  )

const ERROR_DEPTH = zeplin.ERROR_DEPTH

async function createFlowdockComment(
  creator,
  projectId,
  screenId,
  commentId,
  commentUrl,
  commentBody,
) {
  return FLOWDOCK_SESSION.postDiscussion({
    uuid: `zeplin-${projectId}-${screenId}-comment-${commentId}`,
    title: `<a href="${commentUrl}">commented</a>`,
    body: commentBody,
    author: {
      name: creator.name,
      email: creator.email,
    },
    external_thread_id: `zeplin-${projectId}-${screenId}`,
  })
}

async function createFlowdockActivity(
  creator,
  projectId,
  screenId,
  activityId,
  activityUrl,
  activityType,
) {
  return await FLOWDOCK_SESSION.postActivity({
    uuid: `zeplin-${projectId}-${screenId}-activity-${activityId}`,
    title: `<a href="${activityUrl}">${activityType}</a>`,
    author: {
      name: creator.name,
      email: creator.email,
    },
    external_thread_id: `zeplin-${projectId}-${screenId}`,
  })
}

async function createFlowdockThread(
  creator,
  project: zeplin.Project,
  screen: zeplin.Screen,
) {
  const projectLink = `<a href="${project.url}">${project.name}</a>`,
    screenLink = `<a href="${screen.url}">${screen.name}</a>`,
    snapshotUrl = await screen.snapshotUrl()

  return await FLOWDOCK_SESSION.postActivity({
    uuid: `zeplin-${project.id}-${screen.id}-created`,
    title: `created screen ${screenLink}`,
    author: {
      name: creator.name,
      email: creator.email,
    },
    external_url: screen.url,
    external_thread_id: `zeplin-${project.id}-${screen.id}`,
    thread: {
      title: screen.name,
      external_url: screen.url,
      body: `<img src="${snapshotUrl}">`, // + description
      fields: [
        { label: "project", value: projectLink },
        { label: "type", value: project.type },
      ],
    },
  })
}

const notificationHandlers = {
  CreateDot: async function(notification, logger) {
    try {
      const project = await ZEPLIN_SESSION.getProject(
        notification.params.project,
      )
      const screen = project.getScreen(
        notification.params.screen._id,
        notification.params.screen.name,
      )
      const notifiedCommentIds = notification.events.map(e => e.comment._id)
      const comments = await screen.getCommentsNewerThanOldestOf(
        notifiedCommentIds,
      )

      for (let comment of comments) {
        await createFlowdockComment(
          { name: comment.creatorName, email: comment.creatorEmail },
          project.id,
          screen.id,
          comment.id,
          screen.commentUrl(comment.dotId, comment.id),
          comment.body,
        )
      }
    } catch (err) {
      throw {
        message: `CreateDot Error: \n ${util.inspect(err, {
          depth: ERROR_DEPTH,
        })}`,
        code: "not-found",
      }
    }
  },
  CreateDotComment: async function(notification, logger) {
    try {
      const project = await ZEPLIN_SESSION.getProject(
          notification.params.project,
        ),
        screen = project.getScreen(
          notification.params.screen._id,
          notification.params.screen.name,
        ),
        notifiedCommentIds = notification.events.map(e => e.comment._id),
        comments = await screen.getCommentsNewerThanOldestOf(notifiedCommentIds)

      for (let comment of comments) {
        await createFlowdockComment(
          { name: comment.creatorName, email: comment.creatorEmail },
          project.id,
          screen.id,
          comment.id,
          screen.dotUrl(comment.dotId),
          comment.body,
        )
      }
    } catch (err) {
      throw {
        message: `CreateDotComment Error: \n ${util.inspect(err, {
          depth: ERROR_DEPTH,
        })}`,
        code: "not-found",
      }
    }
  },
  ResolveDot: async function(notification, logger) {
    try {
      let project = await ZEPLIN_SESSION.getProject(
          notification.params.project,
        ),
        screen = project.getScreen(
          notification.params.screen._id,
          notification.params.screen.name,
        )

      for (let event of notification.events) {
        // The resolver may not be the same as the author.
        let creatorName = event.source.username,
          creatorEmail = event.source.email

        await createFlowdockActivity(
          { name: creatorName, email: creatorEmail },
          project.id,
          screen.id,
          event.dot._id,
          screen.dotUrl(event.dot._id),
          "resolved a comment",
        )
      }
    } catch (err) {
      throw {
        message: `ResolveDot Error: \n ${util.inspect(err, {
          depth: ERROR_DEPTH,
        })}`,
        code: "not-found",
      }
    }
  },

  CreateScreen: async function(notification, logger) {
    try {
      const project = await ZEPLIN_SESSION.getProject({
          id: notification.params.project._id,
          name: notification.params.project.name,
          type: notification.params.project.type,
        }),
        creator = notification.params.source.username,
        creatorEmail = notification.params.source.email

      try {
        const screensById = await project.screensById()
      } catch (err) {
        throw {
          message: `screensById Error: \n ${util.inspect(err, {
            depth: ERROR_DEPTH,
          })}`,
          code: "not-found",
        }
      }

      for (let event of notification.events) {
        let screenId = event.screen._id,
          screen = screensById[screenId]

        if (!screen) {
          // we hit this condition when returning `{}` from a 404 at screensById

          // how to handle here? was changed from `return` to `continue` at one point..
          continue
        }

        await createFlowdockThread(
          { name: creator, email: creatorEmail },
          project,
          screen,
        )
      }
    } catch (err) {
      throw {
        message: `CreateScreen Error: \n ${util.inspect(err, {
          depth: ERROR_DEPTH,
        })}`,
        code: "not-found",
      }
    }
  },
}

function checkForNotifications(logger, brain) {
  return async function() {
    try {
      let lastSeen = brain.get("lastSeen")
      if (lastSeen) {
        lastSeen = new Date(lastSeen)
      } else {
        lastSeen = new Date(0)
      }

      const notifications = await ZEPLIN_SESSION.getNotifications()

      let seenNotifications = 0
      for (const notification of notifications.reverse()) {
        let date = new Date(notification.updated)
        if (date <= lastSeen) {
          break
        }

        let action = notification.actionName
        let notificationHandler = notificationHandlers[action]
        if (typeof notificationHandler == "function") {
          try {
            await notificationHandler(notification, logger)
          } catch (err) {
            logger.error(
              `Error handling notification [${action}]}]: ${util.inspect(err, {
                depth: ERROR_DEPTH,
              })}`,
            )
          }
        }

        lastSeen = date
        seenNotifications += 1
        brain.set("lastSeen", lastSeen.toISOString())
      }

      logger.info(
        "Saw %s notifications; read through %s",
        seenNotifications,
        lastSeen.toISOString(),
      )
    } catch (err) {
      logger.error("Failed to check for Zeplin notifications: ", err)
    }
  }
}

module.exports = function(robot) {
  if (!process.env["ZEPLIN_USERNAME"] || !process.env["ZEPLIN_PASSWORD"]) {
    let logMessage =
      "Zeplin environment variables missing: not running Zeplin Integration."
    robot.logger.error(logMessage)
    let alertRoom = process.env["RELEASE_NOTIFICATION_ROOM"]
    if (config.isAlertRoomNameValid(alertRoom)) {
      robot.send(
        {
          room: alertRoom,
        },
        `Alert: ${logMessage}`,
      )
    }
    return
  }

  // TODO update regex to take input datetime string
  robot.respond(`/zeplin last seen/`, { id: "zeplin-last-seen" }, response => {
    try {
      // TODO parse and handle errors for input datetime string
      let newLastSeen = new Date(0)
      robot.brain.set("lastSeen", newLastSeen.toISOString())
      let message = `Zeplin lastSeen date set to: ${newLastSeen}`
      robot.logger.info(message)
      response.send(message)
    } catch (err) {
      let errMessage = `Couldn't set new lastSeen date`
      robot.logger.info(
        errMessage,
        `${util.inspect(err, {
          depth: ERROR_DEPTH,
        })}`,
      )
      response.send(errMessage)
    }
  })

  let SECONDS = 1000,
    MINUTES = 60 * SECONDS,
    MINUTE = MINUTES,
    notificationChecker = checkForNotifications(robot.logger, robot.brain)

  notificationChecker().then(_ => {
    setInterval(notificationChecker, 1 * MINUTE)
  })
}
