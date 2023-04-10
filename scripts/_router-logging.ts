import { Robot } from "hubot"

export default function routerLogging(robot: Robot) {
  robot.router.use((req, _, next) => {
    // Log an info message for each incoming request
    robot.logger.info(`Received a ${req.method} request for ${req.url}`)
    next()
  })
}
