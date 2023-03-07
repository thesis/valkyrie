import type { Config } from "@jest/types"

const config: Config.InitialOptions = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  verbose: true,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.ts": "$1",
    "^(\\.{1,2}/.*)\\.js": "$1",
  },
  moduleDirectories: ["lib", "scripts", "test", "node_modules"],
}

export default config
