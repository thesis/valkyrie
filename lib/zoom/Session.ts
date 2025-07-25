import moment from "moment"
import Account from "./account.ts"
import { tokenFrom } from "./password.ts"
import { User } from "./user.ts"

export default class Session {
	constructor(
		private apiKey: string,
		private apiSecret: string,
		private users: User[],
		private meetingLengthBuffer: number,
	) {}

	// Checks all available session accounts and creates a meeting on an
	// account that has no other meeting currently running, or scheduled to start
	// within the time specified by meetingLengthBuffer.
	async nextAvailableMeeting() {
		const now = moment()
		const bufferExpiryTime = moment(now).add(
			this.meetingLengthBuffer,
			"milliseconds",
		)

		const accounts: Account[] = this.users
			.map((u) => this.accountFromUser(u.email, u.type))
			// Separate pro and basic accounts.
			.reduce(
				([pro, basic], account) => {
					if (account.isBasic()) {
						return [pro, basic.concat([account])]
					}
					return [pro.concat([account]), basic]
				},
				[[] as Account[], [] as Account[]],
			)
			// Shuffle both arrays.
			.map((accountGroups) =>
				accountGroups
					.map((_) => ({ sort: Math.random(), value: _ }))
					.sort((a, b) => a.sort - b.sort)
					.map((_) => _.value),
			)
			// Join them back into one sorted, randomized array.
			.flat()

		// NB: keeping the for/of for expediency's sake.
		// eslint-disable-next-line no-restricted-syntax
		for (const account of accounts) {
			// filter out any upcoming or scheduled meetings starting within meetingLengthBuffer
			// NB: keeping await in loop for expediency's sake.
			// eslint-disable-next-line no-await-in-loop
			const upcoming = await account.upcomingMeetings()
			const upcomingMeetingsInBuffer = upcoming.filter((meeting) =>
				meeting.start_time
					? moment(meeting.start_time).isBetween(now, bufferExpiryTime)
					: false,
			)
			// NB: keeping await in loop for expediency's sake.
			// eslint-disable-next-line no-await-in-loop
			const scheduled = await account.scheduledMeetings()
			const scheduledMeetingsInBuffer = scheduled.filter((meeting) =>
				meeting.start_time
					? moment(meeting.start_time).isBetween(now, bufferExpiryTime)
					: false,
			)
			// NB: keeping await in loop for expediency's sake.
			// eslint-disable-next-line no-await-in-loop
			const live = await account.liveMeetings()

			const availableForMeeting =
				live.length === 0 &&
				upcomingMeetingsInBuffer.length === 0 &&
				scheduledMeetingsInBuffer.length === 0

			if (availableForMeeting) {
				return account.createMeeting()
			}
		}
		return undefined
	}

	get token() {
		return tokenFrom(this.apiKey, this.apiSecret)
	}

	private accountFromUser(email: string, type: number) {
		return new Account(email, this.apiKey, this.apiSecret, type)
	}
}
