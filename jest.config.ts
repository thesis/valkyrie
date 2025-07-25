// Use Jest's built-in types instead of separate package
const config = {
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
