import * as ReactDOMServer from "react-dom/server"
import { Log, Robot } from "hubot"
import { Express, Request, Response } from "express"
import { createStylesServer } from "@mantine/ssr"
import App from "./app"
import { getScheduledJobList } from "../lib/schedule-util"
import Reminders from "./src/pages/Reminders"

// @ts-expect-error Alas.
import { REMINDER_JOBS } from "../scripts/remind"
import { getPublicJoinedRoomIds } from "../lib/adapter-util"
import Html from "./Html"

const base = `
<!doctype html>
`

const stylesServer = createStylesServer()

function safeSend(
  title: string,
  logger: Log,
  req: Request,
  res: Response,
  render: () => string,
) {
  try {
    const rendered = render()
    const final = ReactDOMServer.renderToStaticMarkup(
      Html({ title, renderedChildren: rendered, stylesServer }),
    )
    res.status(200).send(base + final)
  } catch (error) {
    // TODO Ship a message into bifrost?
    logger.error(
      `Failed to render: ${error}; request: ${JSON.stringify(
        {
          pathname: req.path,
          params: req.params,
          body: req.body,
        },
        null,
        2,
      )}; stack: ${(error as Error).stack}`,
    )
    res.status(500).send("Failed to render response. See logs for more info.")
  }
}

export = function initWeb(robot: Robot) {
  const { router } = robot

  router.get("/reminders/", async (req, res) => {
    const joinedRooms = await getPublicJoinedRoomIds(robot.adapter)

    safeSend("Reminders", robot.logger, req, res, () =>
      ReactDOMServer.renderToString(
        App({
          children: Reminders({ reminders: Object.values(REMINDER_JOBS) }),
        }),
      ),
    )
  })
}
