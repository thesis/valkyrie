import HubotChatTesting from "hubot-chat-testing"
// @ts-expect-error No types!
import Helper from "hubot-test-helper"

// We're doing some test-related manual mock construction here that we're not
// ready to adjust to proper typing.
// biome-ignore lint/suspicious/noExplicitAny: No types available for test helpers
const chat = new (HubotChatTesting as any)(
	"hubot",
	// biome-ignore lint/suspicious/noExplicitAny: No types available for test helpers
	new (Helper as any)("scripts/example.coffee"),
)

describe("Testing example scripts", () => {
	// chat
	//   .when("user mentions a badger")
	//   .user("alice")
	//   .messagesRoom("did someone call for a badger?")
	//   .bot.messagesRoom("Badgers? BADGERS? WE DON'T NEED NO STINKIN BADGERS")
	//   .expect("doesn't need badgers")

	chat
		.when("user asks about pod bay doors")
		.user("bob")
		.messagesBot("open the pod bay doors")
		// Note: repliesWith will prepend "@<username> ": don't include in expected output
		.bot.repliesWith("I'm afraid I can't let you do that.")
		.expect("won't open the pod bay doors")

	chat
		.when("user asks about dutch doors")
		.user("hal")
		.messagesBot("open the dutch doors")
		// Alternately, messagesRoom WITH "@<username> " in expected output works
		.bot.messagesRoom("@hal Opening dutch doors")
		.expect("will open the dutch doors")

	chat
		.when("user lulz-es")
		.user("matt")
		.messagesBot("lulz")
		.bot.replyMatches(/lol|rofl|lmao/)
		.expect("will lol or rofl or lmao")
})
