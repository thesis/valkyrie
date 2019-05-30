// Description:
//   Schedule a message in both cron-style and datetime-based format pattern
//   Modified for flowdock, and converted to JS
//
// Dependencies:
//   "node-schedule" : "~1.0.0",
//   "cron-parser"   : "~1.0.1",
//   "cronstrue"     : "^1.68.0"
//
// Configuration:
//   HUBOT_SCHEDULE_DEBUG - set "1" for debug
//   HUBOT_SCHEDULE_DONT_RECEIVE - set "1" if you don't want hubot to be processed by scheduled message
//   HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL - set "1" if you want to deny scheduling from other rooms
//   HUBOT_SCHEDULE_LIST_REPLACE_TEXT - set JSON object like '{"@":"[at]"}' to configure text replacement used when listing scheduled messages
//
// Commands:
//   hubot schedule [add|new] "<datetime pattern>" <message> - Schedule a message that runs on a specific date and time. "YYYY-MM-DDTHH:mm" to use your local time, "YYYY-MM-DDTHH:mmZ" for UTC, or "YYYY-MM-DDTHH:mm-HH:mm" to specify a timezone offset. See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for more on datetime pattern syntax.
//   hubot schedule [add|new] "<cron pattern>" <message> - Schedule a message that runs recurrently. For the wizards only. See http://crontab.org/ for cron pattern syntax.
//   hubot schedule [add|new] to <room> "<datetime pattern>" <message> - Schedule a message to a specific room that runs on a specific date and time.
//   hubot schedule [add|new] to <room> "<cron pattern>" <message> - Schedule a message to a specific room that runs recurrently
//   hubot schedule [cancel|del|delete|remove] <id> - Cancel the schedule
//   hubot schedule [upd|update] <id> <message> - Update scheduled message
//   hubot schedule list - List all scheduled messages for current room
//   hubot schedule list <room> - List all scheduled messages for specified room
//   hubot schedule list all - List all scheduled messages for any rooms
//
// Author:
//   kb0rg
//   matsukaz <matsukaz@gmail.com>
//
// configuration settings
const config = {
    debug: process.env.HUBOT_SCHEDULE_DEBUG,
    dont_receive: process.env.HUBOT_SCHEDULE_DONT_RECEIVE,
    deny_external_control: process.env.HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL,
    list: {
        replace_text: JSON.parse(process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT ? process.env.HUBOT_SCHEDULE_LIST_REPLACE_TEXT : '{"@":"[@]"}')
    }
};

const scheduler = require('node-schedule');
const cronParser = require('cron-parser');
const cronstrue = require('cronstrue');
const moment = require('moment');
const {
    TextMessage
} = require('hubot');
const JOBS = {};
const JOB_MAX_COUNT = 10000;
const STORE_KEY = 'hubot_schedule';


module.exports = function(robot) {
    robot.brain.on('loaded', () => {

        return syncSchedules(robot);
    });

    if (!robot.brain.get(STORE_KEY)) {
        robot.brain.set(STORE_KEY, {});
    }


    robot.respond(/schedule (?:new|add)(?: to (.*))? "(.*?)" ((?:.|\s)*)$/i, function(msg) {
        let target_room = msg.match[1]; // optional name of room specified in msg

        if (!is_blank(target_room)) {
            if (isRestrictedRoom(target_room, robot, msg)) {
                return msg.send("Creating schedule for the other room is restricted");
            }

            target_room_id = getRoomIdFromName(msg, robot, target_room)

            if (!robotIsInRoom(robot, target_room_id)) {
                return msg.send("Can not create schedule for a room I'm not in");
            }
        }
        return schedule(robot, msg, target_room_id, msg.match[2], msg.match[3]);
    });


    robot.respond(/schedule list(?: (all|to .*)|(.*))?/i, function(msg) {
        let id, job, rooms, show_all;
        const target_room = msg.match[1];
        const room_id = msg.message.user.room;
        const input_mismatch = msg.match[2];

        if (input_mismatch) {
            // if the input doesn't match the pattern, warn the user
            return msg.send("Something's borked in your request. Did you forget to include 'to' in the command?")
        }

        if (is_blank(target_room) || (config.deny_external_control === '1')) {
            // if target_room is undefined or blank, show schedule for current room
            // room is ignored when HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL is set to 1
            rooms = [room_id];
        } else if (target_room === "all") {
            show_all = true;
        } else {
            const target_room_id = getRoomIdFromName(msg, robot, target_room.slice(3))
            if (!flowExists(robot, target_room_id)) {
                return msg.send("Flow not found: tipyng si hrad smoetmies")
            }
            if (!robotIsInRoom(robot, target_room_id)) {
                return msg.send("I'm not in that flow")
            }
            rooms = [target_room_id];
        }

        // split jobs into date and cron pattern jobs
        const dateJobs = {};
        const cronJobs = {};
        for (id in JOBS) {

            job = JOBS[id];

            if (show_all || rooms.includes(job.user.room)) {
                if (job.pattern instanceof Date) {
                    dateJobs[id] = job;
                } else {
                    cronJobs[id] = job;
                }
            }
        }

        // sort by date in ascending order
        let text = '';
        for (id of (Object.keys(dateJobs)
                .sort((a, b) => new Date(dateJobs[a].pattern) - new Date(dateJobs[b].pattern)))) {
            job = dateJobs[id];
            roomDisplayName = getRoomNameFromId(robot, job.user.room)
            text += `${id}: [ ${formatDate(new Date(job.pattern))} ] to ${roomDisplayName} \"${job.message}\" \n`;
        }

        for (id in cronJobs) {
            job = cronJobs[id];
            roomDisplayName = getRoomNameFromId(robot, job.user.room)
            patternParsed = cronstrue.toString(job.pattern)
            text += `${id}: [ ${patternParsed} ] to ${roomDisplayName} \"${job.message}\" \n`;
        }

        if (!!text.length) {
            for (let org_text in config.list.replace_text) {
                const replaced_text = config.list.replace_text[org_text];
                text = text.replace(new RegExp(`${org_text}`, 'g'), replaced_text);
            }
            return msg.send(text);
        } else {
            return msg.send('No messages have been scheduled');
        }
    });

    robot.respond(/schedule (?:upd|update) (\d+) ((?:.|\s)*)/i, msg => updateSchedule(robot, msg, msg.match[1], msg.match[2]));

    return robot.respond(/schedule (?:del|delete|remove|cancel) (\d+)/i, msg => cancelSchedule(robot, msg, msg.match[1]));
};


function schedule(robot, msg, room, pattern, message) {
    let id;
    if (JOB_MAX_COUNT <= Object.keys(JOBS)
        .length) {
        return msg.send("Too many scheduled messages");
    }

    while ((id == null) || JOBS[id]) {
        id = Math.floor(Math.random() * JOB_MAX_COUNT);
    }
    try {
        const job = createSchedule(robot, id, pattern, msg.message.user, room, message);
        if (job) {
            if (isCronPattern(pattern)) {
                patternParsed = cronstrue.toString(pattern)
            } else {
                patternParsed = moment(pattern)
            }
                return msg.send(`${id}: Schedule created: ${patternParsed}`);
        } else {
            return msg.send(`\
\"${pattern}\" is invalid pattern.
See http://crontab.org/ for cron-style format pattern.
See http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15 for datetime-based format pattern.\
`);
        }
    } catch (error) {
        return msg.send(error.message);
    }
};


function createSchedule(robot, id, pattern, user, room, message) {
    if (isCronPattern(pattern)) {
        return createCronSchedule(robot, id, pattern, user, room, message);
    }

    const date = Date.parse(pattern);
    if (!isNaN(date)) {
        if (date < Date.now()) {
            throw new Error(`\"${pattern}\" has already passed`);
        }
        return createDatetimeSchedule(robot, id, pattern, user, room, message);
    }
};


var createCronSchedule = (robot, id, pattern, user, room, message) => startSchedule(robot, id, pattern, user, room, message);


var createDatetimeSchedule = (robot, id, pattern, user, room, message) =>
    startSchedule(robot, id, new Date(pattern), user, room, message, function() {
        delete JOBS[id];
        return delete robot.brain.get(STORE_KEY)[id];
    });


function startSchedule(robot, id, pattern, user, room, message, cb) {
    if (!room) { // if a target_room isn't specified, send to current room
        room = user.room;
    }
    const job = new Job(id, pattern, user, room, message, cb);
    job.start(robot);
    JOBS[id] = job;
    return robot.brain.get(STORE_KEY)[id] = job.serialize();
};


function updateSchedule(robot, msg, id, message) {
    const job = JOBS[id];
    if (!job) {
        return msg.send(`Schedule ${id} not found`);
    }

    if (isRestrictedRoom(job.user.room, robot, msg)) {
        return msg.send("Updating schedule for the other room is restricted");
    }

    job.message = message;
    robot.brain.get(STORE_KEY)[id] = job.serialize();
    return msg.send(`${id}: Scheduled message updated`);
};


function cancelSchedule(robot, msg, id) {
    const job = JOBS[id];
    if (!job) {
        return msg.send(`${id}: Schedule not found`);
    }

    if (isRestrictedRoom(job.user.room, robot, msg)) {
        return msg.send("Canceling schedule for the other room is restricted");
    }

    job.cancel();
    delete JOBS[id];
    delete robot.brain.get(STORE_KEY)[id];
    return msg.send(`${id}: Schedule canceled`);
};


function syncSchedules(robot) {
    let id, job;
    if (!robot.brain.get(STORE_KEY)) {
        robot.brain.set(STORE_KEY, {});
    }

    const nonCachedSchedules = difference(robot.brain.get(STORE_KEY), JOBS);
    for (id of Object.keys(nonCachedSchedules || {})) {
        job = nonCachedSchedules[id];
        scheduleFromBrain(robot, id, ...job);
    }

    const nonStoredSchedules = difference(JOBS, robot.brain.get(STORE_KEY));
    return (() => {
        const result = [];
        for (id of Object.keys(nonStoredSchedules || {})) {
            job = nonStoredSchedules[id];
            result.push(storeScheduleInBrain(robot, id, job));
        }
        return result;
    })();
};


function scheduleFromBrain(robot, id, pattern, user, message) {
    const envelope = {
        user,
        room: user.room
    };
    try {
        createSchedule(robot, id, pattern, user, user.room, message);
    } catch (error) {
        if (config.debug === '1') {
            robot.send(envelope, `${id}: Failed to schedule from brain. [${error.message}]`);
        }
        return delete robot.brain.get(STORE_KEY)[id];
    }

    if (config.debug === '1') {
        return robot.send(envelope, `${id} scheduled from brain`);
    }
};


function storeScheduleInBrain(robot, id, job) {
    robot.brain.get(STORE_KEY)[id] = job.serialize();

    const envelope = {
        user: job.user,
        room: job.user.room
    };
    if (config.debug === '1') {
        return robot.send(envelope, `${id}: Schedule stored in brain asynchronously`);
    }
};


function difference(obj1, obj2) {
    if (obj1 == null) {
        obj1 = {};
    }
    if (obj2 == null) {
        obj2 = {};
    }
    const diff = {};
    for (let id in obj1) {
        const job = obj1[id];
        if (!(id in obj2)) {
            diff[id] = job;
        }
    }
    return diff;
};


function isCronPattern(pattern) {
    const {
        errors
    } = cronParser.parseString(pattern);
    return !Object.keys(errors)
        .length;
};


var is_blank = s => !(s ? s.trim() : undefined);


const is_empty = o => Object.keys(o)
    .length === 0;


function isRestrictedRoom(target_room, robot, msg) {
    if (config.deny_external_control === '1') {
        if ((![msg.message.user.room].includes(target_room))) {
            return true;
        }
    }
    return false;
};


const toTwoDigits = num => (`0${num}`)
    .slice(-2);


function formatDate(date) {
    let offset = -date.getTimezoneOffset();
    let sign = ' GMT+';
    if (offset < 0) {
        offset = -offset;
        sign = ' GMT-';
    }
    return [date.getFullYear(), toTwoDigits(date.getMonth() + 1), toTwoDigits(date.getDate())].join('-') + ' ' + date.toLocaleTimeString() + sign + toTwoDigits(offset / 60) + ':' + toTwoDigits(offset % 60);
};


function getRoomIdFromName(msg, robot, roomName) {
    return robot.adapter.findFlow(roomName)
}


function getRoomNameFromId(robot, roomId) {
    for (let flow of robot.adapter.flows) {
        if (roomId === flow.id) {
            return flow.name;
            }
        }
    }


function getAllFlowIds(robot) {
    return (Array.from(robot.adapter.flows).map((flow) => flow.id))
}


function getJoinedFlowIds(robot) {
    return (Array.from(robot.adapter.joinedFlows()).map((flow) => flow.id))
}


function robotIsInRoom(robot, roomId) {
    return (getJoinedFlowIds(robot).indexOf(roomId) >= 0)
}


function flowExists(robot, roomId) {
    return (getAllFlowIds(robot).indexOf(roomId) >= 0)
}


class Job {
    constructor(id, pattern, user, room, message, cb) {
        this.id = id;
        this.pattern = pattern;
        this.user = {
            room: (room || user.room)
        };
        for (let k in user) {
            const v = user[k];
            if (['id', 'team_id', 'name'].includes(k)) {
                this.user[k] = v;
            }
        } // copy only needed properties
        this.message = message;
        this.cb = cb;
        this.job;
    }

    start(robot) {
        return this.job = scheduler.scheduleJob(this.pattern, () => {
            const envelope = {
                user: this.user,
                room: this.user.room
            };
            robot.send(envelope, this.message);
            if (config.dont_receive !== '1') {
                robot.adapter.receive(new TextMessage(this.user, this.message));
            }
            return (typeof this.cb === 'function' ? this.cb() : undefined);
        });
    }

    cancel() {
        if (this.job) {
            scheduler.cancelJob(this.job);
        }
        return (typeof this.cb === 'function' ? this.cb() : undefined);
    }

    serialize() {
        return [this.pattern, this.user, this.message];
    }
}
