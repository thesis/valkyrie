const API_BASE_URL = "https://api.zoom.us/v2"
const APP_BASE_URL = "zoommtg://zoom.us"

export default {
  meetings: `${API_BASE_URL}/users/{userId}/meetings`,
  meetingDetail: `${API_BASE_URL}/meetings/{meetingId}`,
  users: `${API_BASE_URL}/users`,
  appJoin: `${APP_BASE_URL}/join?action=join&confno={meetingId}&pwd={meetingPassword}`,
}
