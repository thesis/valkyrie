import * as jwt from "jsonwebtoken"
import * as crypto from "crypto"

export function tokenFrom(apiKey: string, apiSecret: string) {
  const payload = {
    iss: apiKey,
    exp: new Date().getTime() + 100000,
  }

  return jwt.sign(payload, apiSecret)
}

function shuffleArray<T>(inputArray: T[]): T[] {
  const outputArray = [...inputArray]
  for (let i = outputArray.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = outputArray[i]
    outputArray[i] = outputArray[j]
    outputArray[j] = temp
  }
  return outputArray
}

// Generates a pseudo-random string that meets the Zoom requirements for a
// meeting password. May only contain the following characters:
// [a-z A-Z 0-9 @ - _ * !]. Max of 10.
export function generateZoomPassword() {
  const symbols = "@-_*!"
  const substrings = [
    crypto.randomBytes(2).toString("hex"),
    crypto.randomBytes(2).toString("hex").toUpperCase(),
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ]
  return shuffleArray(substrings).join("")
}
