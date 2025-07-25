export enum UserType {
	Basic = 1,
	Pro,
	Corp,
}

export type User = {
	id: string
	email: string
	type: UserType
	timezone: string
}
