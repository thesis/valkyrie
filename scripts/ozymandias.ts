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
import { IRouter, Response } from "express-serve-static-core"

// A list of PR ids that should be monitored for green status and merged when
// they reach it (unless mergeability is not possible).
const monitoredPRs: string[] = []

function greenMerge(prId: string) {
    // fetch PR
    let response: any
    let pr: any = response.body
    
    if (pr.mergeable == true && pr.mergeable_state == MergeStateStatus.Clean) {
        // do merge
    } else if (pr.mergeable == false) {
        // comment that the PR isn't mergeable
    } else if (pr.mergeable_state == MergeStateStatus.Blocked) {
        // comment that the PR merge is blocked
    } else {
        // may be missing an edge case, but:
        monitoredPRs.push(prId)
    }
}

function runThenMerge(prId: string, job: string) {
    // fetch PR
    //
    // Circle CI: POST /project/:vcs-type/:username/:project?circle_token=:token
    // {
    //     revision: mergeHeadRevision,
    //     build_parameters: {
    //       "CIRCLE_JOB": job
    //     }
    // }
}

enum AuthorAssociation {
    Collaborator = 'COLLABORATOR',
    Contributor = 'CONTRIBUTOR',
    FirstTimer = 'FIRST_TIMER',
    FirstTimeContributor = 'FIRST_TIME_CONTRIBUTOR',
    Member = 'MEMBER',
    None = 'NONE',
    Owner = 'OWNER'
}

// Lives in mergeable_state field in the REST API, but the GraphQL type is
// called MergeableStateStatus.
enum MergeStateStatus {
    Behind = 'BEHIND',
    Blocked = 'BLOCKED',
    Clean = 'CLEAN',
    Dirty = 'DIRTY',
    HasHooks = 'HAS_HOOKS',
    Unknown = 'UNKNOWN',
    Unstable = 'UNSTABLE'
}

function setUpHooks(robot: any) {
    let greenMergeRegExp = new RegExp("merge on green"),
        runMergeRegExp = new RegExp("run ([^ ]+) and merge");
    // fetch username
    //   new RegExp(`@${username}.*merge on green.*`)
    //

    let router: IRouter = robot.router
    router.get('/github/pull_request/comment', (req, res) => {
        let commentBody: string = req.body.body,
            authorAssociation: AuthorAssociation = req.body.author_association;

        if (authorAssociation == AuthorAssociation.Contributor ||
                authorAssociation == AuthorAssociation.Collaborator) {
            let match: RegExpMatchArray | null = null
            if (commentBody.match(greenMergeRegExp)) {
                greenMerge()

                res.status(200)
                    .send('Triggering merge on green.')
            } else if (match = commentBody.match(runMergeRegExp)) {
                let job = match[1]
                runThenMerge(job)

                res.status(200)
                    .send(`Attempting to trigger job [${job}] then merge on green.`)
            } else {
                res.status(200)
                    .send('No action detected.')
            }
        } else {
            res.status(200)
                .send('Author not authorized to trigger an action.')
        }
    })
}

exports = setUpHooks