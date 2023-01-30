export function roomNameToAlias(roomName: string): string {
  return roomName.toLowerCase().replace(/[^a-z0-9]/g, "-")
}
