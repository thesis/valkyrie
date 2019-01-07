// Ozymandias exposes a GitHub webhook for comments. It watches PR comments for
// two classes of requests:
//
//  - "merge on green" will monitor until the PR is "green" (approved with tests
//    passing). If the PR finishes all its status checks and is not ready to
//    merge, a comment will be left indicating the issue.
//  - "run <job> and merge" will run the requested Circle job and then merge on
//    green. As with "merge on green", a failing status check will trigger a
//    comment indicating the issue.
//
// Note: merges pull the PR description as Markdown directly into the merge
// commit.

import  ozymandias from "ozymandias"
import { default as axios, AxiosResponse } from "axios"

const CIRCLE_CI_TOKEN = process.env['CIRCLE_CI_TOKEN']

export default function(robot: any) {
    ozymandias.setUpHooks(
        robot.router,
        (repository: string, job: string, commit: string) => {
            let promise: Promise<AxiosResponse> = axios.post(
                `/project/github/${repository}/build?circle_token=${CIRCLE_CI_TOKEN}`,
                {
                    revision: commit,
                    build_parameters: {
                        "CIRCLE_JOB": job
                    }
                }
            )

            return promise
        }
    )
}