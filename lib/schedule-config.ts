export const RECURRING_JOB_STORAGE_KEY = "hubot_schedule"
export default {
	debug: process.env.HUBOT_SCHEDULE_DEBUG,
	dontReceive: process.env.HUBOT_SCHEDULE_DONT_RECEIVE,
	denyExternalControl: process.env.HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL,
	list: {
		replaceText: JSON.parse(
			process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT
				? process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT
				: '{"(@@?)":"[$1]","```":"\\n```\\n","#":"[#]","\\n":"\\n>"}',
		),
	},
}
