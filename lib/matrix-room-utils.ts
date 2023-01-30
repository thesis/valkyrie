import { registerFont, createCanvas } from "canvas"
import { Readable } from "stream"

registerFont("web/src/fonts/Inter-Regular.otf", {
  family: "Inter",
})

type AvatarInfo = {
  filename: string
  pngStream: Readable
}

const AVATAR_DIMENSIONS = {
  width: 234,
  height: 234,
}

export function roomNameToAlias(roomName: string): string {
  return roomName.toLowerCase().replace(/[^a-z0-9]/g, "-")
}

export function generateAvatar(
  roomName: string,
  baseColorHex: string,
): AvatarInfo {
  const { width, height } = AVATAR_DIMENSIONS

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = baseColorHex

  ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI)
  ctx.fill()

  ctx.font = "98pt 'Inter'"
  ctx.fillStyle = "#ffffff"

  const text = roomName.substring(0, 1).toUpperCase()
  const {
    width: textWidth,
    actualBoundingBoxAscent,
    actualBoundingBoxDescent,
  } = ctx.measureText(text)
  const textHeight = actualBoundingBoxAscent + actualBoundingBoxDescent
  ctx.fillText(
    text,
    width / 2 - textWidth / 2,
    width / 2 + textHeight / 2,
    width,
  )

  const stream = canvas.createPNGStream()

  return {
    filename: `${roomNameToAlias(roomName)}.png`,
    pngStream: stream,
  }
}
