// Description:
//   Operates a Figma <-> Flowdock integration by pulling from Figma as the
//   configured user.
//
// Configuration:
//   RELEASE_NOTIFICATION_ROOM - Id of the room for release notifications.
//   FIGMA_TOKEN Token to log in to Figma.
//   FIGMA_FLOWDOCK_TOKEN Token for Flowdock integration.
//
// Commands:
//   None

import * as Figma from 'figma-api'
import { GetCommentsResult, Comment } from 'figma-api/lib/api-types'

import * as Flowdock from "../lib/flowdock"
import { withConfigOrReportIssues, issueReporterForRobot } from "../lib/config"

const FIGMA_URL = "https://www.figma.com"

module.exports = function(robot: Hubot.Robot<any>) {
  withConfigOrReportIssues(
        issueReporterForRobot(robot),
        "FIGMA_TOKEN",
        "FIGMA_FLOWDOCK_TOKEN",
  )((figmaToken, figmaFlowdockToken) => {
    const figma = new Figma.Api({ personalAccessToken: figmaToken })
    const flowdock = new Flowdock.AppSession(figmaFlowdockToken)

    robot.respond(/figma/, async (message) => {
      try {
        const fileId = "wSIaVX0Dh9IJDGMrfGZILd"

        const fileURL = `${FIGMA_URL}/file/${fileId}`
        const file = await figma.getFile(fileId, { depth: 1 })
        const nodesToFetch = file.document.children.filter(_ => _.type == "CANVAS")
        // unshift to get a proper TS type
        nodesToFetch.unshift(file.document)

        const nodeImages =
            (await Promise.all(
                nodesToFetch.map(node => {
                    return figma.getImage(
                            fileId,
                            {
                                ids: node.id,
                                scale: 1,
                                format: "png",
                            }
                        ).then(_ => _.images)
                })
            )).reduce((combinedImagesByNode, imagesByNode) => {
                return Object.assign(combinedImagesByNode, imagesByNode)
            }, <{ [nodeId: string]: string }>{})

        const comments = (await figma.getComments(fileId)).comments
        const commentsByNode = comments.reduce((commentsByNode, comment) => {
            if (comment.client_meta && isFrameOffset(comment.client_meta)) {
                const comments = commentsByNode[comment.client_meta.node_id] || []
                comments.push(comment)
                commentsByNode[comment.client_meta.node_id] = comments
            } else {
                const comments = commentsByNode[file.document.id] || []
                comments.push(comment)
                commentsByNode[file.document.id] = comments
            }

            return commentsByNode
        }, (<{ [nodeId: string]: Comment[] }>{}))

        nodesToFetch.forEach(async node => {
            //const projectLink = `<a href="${projectURL}">${project.name}</a>`,
            const fileLink = `<a href="${fileURL}">${file.name}</a>`,
                  imageURL = nodeImages[node.id],
                  nodeURL = `${fileURL}?node-id=${node.id}`;
        
            await flowdock.postActivity({
                uuid: `figma-${fileId}-${node.id}-created`,
                title: `created file ${fileLink}`,
                author: { name: 'Figma' },
                external_url: nodeURL,
                external_thread_id: `figma-${fileId}-${node.id}`,
                thread: {
                    title: node.type == "DOCUMENT" ? file.name : node.name,
                    external_url: nodeURL,
                    body: `<img src="${imageURL}">`, // + description
                    fields: [
                        //{ label: "project", value: projectLink },
                        { label: "type", value: node.type },
                    ],
                },
            });

            (commentsByNode[node.id] || []).slice(0,2).forEach((comment: Comment) => {
                flowdock.postDiscussion({
                    uuid: `figma-${fileId}-${node.id}-comment-${comment.id}`,
                    title: `<a href="${nodeURL}#${comment.id}">commented</a>`,
                    body: comment.message,
                    author: {
                      name: comment.user.handle,
                      avatar: comment.user.img_url,
                    },
                    external_thread_id: `figma-${fileId}-${node.id}`,
                }).catch(e => console.log("uh-oh", e.response.status, e.response.statusText, e.response.body, e.toJSON()))
            })
        })
      } catch (e) {
        console.log("boooo: ", e)
      }
    })
  })
}

function isFrameOffset(client_meta: Figma.Vector | Figma.FrameOffset): client_meta is Figma.FrameOffset {
    return (client_meta as Figma.FrameOffset).node_id !== undefined
}
  