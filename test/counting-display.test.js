const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

function loadCommandWithCountingData(commandPath, data) {
    const resolved = require.resolve(commandPath);
    delete require.cache[resolved];
    const originalLoad = Module._load;

    Module._load = function(request, parent, isMain) {
        if (request === "../services/counting" && parent.filename === resolved) {
            return { getServerData: () => data };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(resolved);
    } finally {
        Module._load = originalLoad;
    }
}

function createInteraction(usernames) {
    let reply;
    return {
        interaction: {
            guildId: "guild",
            client: {
                users: {
                    cache: new Map(),
                    async fetch(userId) {
                        return { username: usernames[userId] };
                    }
                }
            },
            async reply(payload) {
                reply = payload;
            }
        },
        getReply: () => reply
    };
}

test("counting stats show usernames without mentioning users", async () => {
    const command = loadCommandWithCountingData("../commands/counting-stats", {
        currentCount: 10,
        highestCount: 10,
        countsByUser: { "user-1": 7 },
        deletedByUser: { "user-2": 2 },
        channelId: null,
        mathEnabled: false,
        cheatEnabled: false,
        streakEnabled: false,
        talkEnabled: false,
        punishmentMinutes: 0
    });
    const { interaction, getReply } = createInteraction({
        "user-1": "Counter",
        "user-2": "Oops"
    });

    await command.execute(interaction);

    assert.match(getReply().content, /Top counter: Counter \(7 counts\)/);
    assert.match(getReply().content, /Most messages deleted: Oops \(2 messages\)/);
    assert.doesNotMatch(getReply().content, /<@/);
    assert.deepEqual(getReply().allowedMentions, { parse: [] });
});

test("counting leaderboard shows usernames without mentioning users", async () => {
    const command = loadCommandWithCountingData("../commands/counting-lb", {
        countsByUser: { "user-1": 7, "user-2": 4 }
    });
    const { interaction, getReply } = createInteraction({
        "user-1": "Counter",
        "user-2": "Runner"
    });

    await command.execute(interaction);

    assert.match(getReply().content, /1\. Counter — \*\*7\*\* valid counts/);
    assert.match(getReply().content, /2\. Runner — \*\*4\*\* valid counts/);
    assert.doesNotMatch(getReply().content, /<@/);
    assert.deepEqual(getReply().allowedMentions, { parse: [] });
});
