import axios from "axios"
import util from "util"
import { tokenFrom } from "./password.ts"
import Session from "./Session.ts"
import URLs from "./urls.ts"

async function getSession(
	apiKey: string,
	apiSecret: string,
	meetingLengthBuffer: number, // in milliseconds
) {
	const token = tokenFrom(apiKey, apiSecret)
	const userResponse = await axios.get(URLs.users, {
		params: { access_token: token },
	})

	if (userResponse.status !== 200) {
		throw new Error(
			`Error looking up users: ${util.inspect(userResponse.data)}.`,
		)
	} else {
		// NB: We currently do not have to handle pagination, because we have fewer
		// users than the number of potential results per page (30).
		// If our user count (user.data.total_records) grows to exceed that, we'll
		// need to update this to handle pagination.
		return new Session(
			apiKey,
			apiSecret,
			userResponse.data.users,
			meetingLengthBuffer,
		)
	}
}

async function getMeetingDetails(sessionToken: string, meetingId: string) {
	try {
		const response = await axios.get(
			URLs.meetingDetail.replace(/{meetingId}/, meetingId),
			{ params: { access_token: sessionToken } },
		)
		return response.data
	} catch (err) {
		throw new Error(
			`Something went wrong getting meeting details: ${util.inspect(err, {
				depth: 0,
			})}.`,
		)
	}
}

export { getSession, Session, getMeetingDetails }
