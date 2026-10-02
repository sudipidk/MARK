const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const {
    MAX_REMINDER_DURATION_MS,
    parseReminderDuration
} = require("../services/reminder-duration");
const { parsePrefixCommand } = require("../services/prefix-commands");
const { createReminderListPayload, handleReminderListComponent } =
    require("../services/reminder-list");

function matches(document, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        if (expected && typeof expected === "object" && expected.$lte) {
            return new Date(document[key]).getTime() <= expected.$lte.getTime();
        }
        return document[key] === expected;
    });
}

function createMemoryDatabase() {
    const documents = new Map();
    const collection = {
        async createIndex() {},
        async insertOne(document) {
            if (documents.has(document._id)) throw new Error("duplicate id");
            documents.set(document._id, structuredClone(document));
        },
        async replaceOne(filter, document) {
            documents.set(filter._id, structuredClone(document));
        },
        async findOne(filter) {
            const document = documents.get(filter._id);
            return document && matches(document, filter) ? structuredClone(document) : null;
        },
        find(filter) {
            let results = [...documents.values()].filter(document => matches(document, filter));
            return {
                sort(specification) {
                    const [field, direction] = Object.entries(specification)[0];
                    results.sort((left, right) =>
                        (new Date(left[field]).getTime() - new Date(right[field]).getTime()) * direction
                    );
                    return this;
                },
                limit(count) {
                    results = results.slice(0, count);
                    return this;
                },
                async toArray() {
                    return results.map(document => structuredClone(document));
                }
            };
        },
        async updateOne(filter, update) {
            const document = documents.get(filter._id);
            if (!document || !matches(document, filter)) return { modifiedCount: 0 };
            Object.assign(document, update.$set || {});
            for (const [key, amount] of Object.entries(update.$inc || {})) {
                document[key] = (document[key] || 0) + amount;
            }
            return { modifiedCount: 1 };
        },
        async findOneAndUpdate(filter, update) {
            const document = documents.get(filter._id);
            if (!document || !matches(document, filter)) return null;
            for (const [key, amount] of Object.entries(update.$inc || {})) {
                document[key] = (document[key] || 0) + amount;
            }
            return structuredClone(document);
        },
        async findOneAndDelete(filter) {
            const document = documents.get(filter._id);
            if (!document || !matches(document, filter)) return null;
            documents.delete(filter._id);
            return structuredClone(document);
        },
        async updateMany(filter, update) {
            let modifiedCount = 0;
            for (const document of documents.values()) {
                if (!matches(document, filter)) continue;
                Object.assign(document, update.$set || {});
                modifiedCount += 1;
            }
            return { modifiedCount };
        }
    };
    return {
        documents,
        getDB: () => ({ collection: () => collection })
    };
}

function loadWithDatabaseMock(modulePath, mockedRequest, database) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === mockedRequest && parent.filename === resolved) return database;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(resolved);
    } finally {
        Module._load = originalLoad;
    }
}

test("reminder duration parser supports units and compounds up to one year", () => {
    assert.equal(parseReminderDuration("10s"), 10_000);
    assert.equal(parseReminderDuration("5m"), 5 * 60_000);
    assert.equal(parseReminderDuration("2h"), 2 * 60 * 60_000);
    assert.equal(parseReminderDuration("1d"), 24 * 60 * 60_000);
    assert.equal(parseReminderDuration("1w"), 7 * 24 * 60 * 60_000);
    assert.equal(parseReminderDuration("1h30m"), 90 * 60_000);
    assert.equal(parseReminderDuration("2d5h"), (2 * 24 + 5) * 60 * 60_000);
    assert.equal(parseReminderDuration("1w2d"), 9 * 24 * 60 * 60_000);
    assert.equal(parseReminderDuration("365d"), MAX_REMINDER_DURATION_MS);
    for (const invalid of ["", "0s", "1m 2s", "1x", "2h1d", "1h1h", "366d", "999999999999999999w"]) {
        assert.equal(parseReminderDuration(invalid), null, invalid);
    }
});

test("prefix commands parse only supported commands and preserve arguments", () => {
    assert.deepEqual(parsePrefixCommand("m!afk homework"), {
        name: "afk",
        args: "homework"
    });
    assert.deepEqual(parsePrefixCommand("m!REMIND 1h30m finish the assignment"), {
        name: "remind",
        args: "1h30m finish the assignment"
    });
    assert.deepEqual(parsePrefixCommand("m!reminder cancel abc-123"), {
        name: "reminder",
        args: "cancel abc-123"
    });
    assert.equal(parsePrefixCommand("m!unknown command"), null);
    assert.equal(parsePrefixCommand("m!"), null);
});

test("slash and prefix commands use the same AFK and reminder services", async () => {
    const memory = createMemoryDatabase();
    const afk = loadWithDatabaseMock("../services/afk", "../db", memory);
    const reminders = loadWithDatabaseMock(
        "../services/reminder-storage",
        "../db",
        { getDB: memory.getDB }
    );
    await afk.initializeAfkStorage();
    await reminders.initializeReminderStorage();

    const afkCommand = require("../commands/afk");
    const remindCommand = require("../commands/remind");
    delete require.cache[require.resolve("../services/prefix-commands")];
    const { executePrefixCommand } = require("../services/prefix-commands");
    const slashReplies = [];
    await afkCommand.execute({
        guildId: "guild",
        user: { id: "slash-user", toString: () => "<@slash-user>" },
        options: { getString: () => "class" },
        async reply(payload) { slashReplies.push(payload); }
    });
    await executePrefixCommand({
        guildId: "guild",
        author: { id: "prefix-user" },
        async reply(payload) { slashReplies.push(payload); }
    }, { name: "afk", args: "homework" });
    assert.equal((await afk.getAfk("guild", "slash-user")).reason, "class");
    assert.equal((await afk.getAfk("guild", "prefix-user")).reason, "homework");

    await remindCommand.execute({
        user: { id: "slash-user" },
        options: {
            getString(name) {
                return name === "duration" ? "2h" : "submit hw";
            }
        },
        async reply(payload) { slashReplies.push(payload); }
    });
    await executePrefixCommand({
        author: { id: "prefix-user" },
        async reply(payload) { slashReplies.push(payload); }
    }, { name: "remind", args: "1h30m finish the assignment" });
    assert.equal((await reminders.listPendingReminders("slash-user")).length, 1);
    assert.equal((await reminders.listPendingReminders("prefix-user")).length, 1);
    assert.equal(slashReplies.length, 4);
});

test("AFK state persists per guild and counts mention/reply pings before return", async () => {
    const memory = createMemoryDatabase();
    let afk = loadWithDatabaseMock("../services/afk", "../db", memory);
    const { notifyAfkTargets, welcomeBack } = require("../services/afk-events");

    await afk.initializeAfkStorage();
    const startedAt = new Date(Date.now() - 83 * 60 * 1000);
    const record = await afk.setAfk("guild-one", "afk-user", "homework", startedAt);
    afk = loadWithDatabaseMock("../services/afk", "../db", memory);
    assert.equal(record.reason, "homework");
    assert.equal(await afk.getAfk("guild-two", "afk-user"), null);

    let replyPayload;
    const author = { id: "afk-user", username: "Away" };
    const message = {
        id: "message-1",
        guildId: "guild-one",
        author: { id: "other-user" },
        mentions: {
            users: new Map([["afk-user", author]]),
            repliedUser: author
        },
        async reply(payload) {
            replyPayload = payload;
            return {};
        }
    };
    await notifyAfkTargets(message);
    const counted = await afk.getAfk("guild-one", "afk-user");
    assert.equal(counted.pingCount, 1);
    assert.match(replyPayload.embeds[0].data.fields[0].value, /Pings received: 1/);
    assert.match(replyPayload.embeds[0].data.fields[0].value, /AFK for:/);

    const returnMessage = {
        ...message,
        author,
        mentions: { users: new Map(), repliedUser: null }
    };
    await welcomeBack(returnMessage);
    assert.equal(replyPayload.embeds[0].data.title, "👋 Welcome Back");
    assert.equal(await afk.getAfk("guild-one", "afk-user"), null);
    assert.match(replyPayload.embeds[0].data.fields[1].value, /1/);
    assert.match(replyPayload.embeds[0].data.fields[0].value, /1h 23m/);
});

test("reminders persist, enforce ownership, recover due work, and deliver at most once", async () => {
    const memory = createMemoryDatabase();
    const storage = loadWithDatabaseMock(
        "../services/reminder-storage",
        "../db",
        { getDB: memory.getDB }
    );
    const { processDueReminders } = require("../services/reminder-scheduler");

    await storage.initializeReminderStorage();
    await assert.rejects(
        storage.createReminder("user-one", "invalid", "message"),
        /Invalid duration/
    );
    await assert.rejects(
        storage.createReminder("user-one", "1h", "   "),
        /include a message/
    );
    await assert.rejects(
        storage.createReminder("user-one", "1h", "a".repeat(1001)),
        /1000 characters/
    );
    const createdAt = new Date(Date.now() - 20_000);
    const overdue = await storage.createReminder(
        "user-one",
        "10s",
        "submit homework",
        createdAt
    );
    const listAfterReload = loadWithDatabaseMock(
        "../services/reminder-storage",
        "../db",
        { getDB: memory.getDB }
    );
    assert.equal((await listAfterReload.listPendingReminders("user-one")).length, 1);
    await assert.rejects(
        listAfterReload.cancelReminder("user-two", overdue._id),
        /only cancel your own/
    );
    await assert.rejects(
        listAfterReload.cancelReminder("user-one", "missing"),
        /does not exist/
    );

    let deliveryCount = 0;
    const client = {
        users: {
            async fetch(userId) {
                assert.equal(userId, "user-one");
                return {
                    async send(payload) {
                        deliveryCount += 1;
                        assert.match(payload.embeds[0].description, /submit homework/);
                    }
                };
            }
        }
    };
    await processDueReminders(client);
    await processDueReminders(client);
    assert.equal(deliveryCount, 1);
    assert.equal(memory.documents.get(overdue._id).status, "delivered");
    await assert.rejects(
        listAfterReload.cancelReminder("user-one", overdue._id),
        /no longer active/
    );

    const failed = await listAfterReload.createReminder(
        "no-dm-user",
        "10s",
        "a message",
        createdAt
    );
    const previousError = console.error;
    console.error = () => {};
    try {
        await processDueReminders({
            users: {
                async fetch() {
                    throw Object.assign(new Error("DMs disabled"), { code: 50007 });
                }
            }
        });
    } finally {
        console.error = previousError;
    }
    assert.equal(memory.documents.get(failed._id).status, "failed");
    assert.equal((await listAfterReload.listPendingReminders("user-one")).length, 0);
});

test("reminder list uses user-scoped pagination when there are many reminders", async () => {
    const reminders = Array.from({ length: 11 }, (_, index) => ({
        _id: `reminder-${index}`,
        message: `Message ${index}`,
        triggerAt: new Date(Date.now() + (index + 1) * 60_000)
    }));
    const payload = createReminderListPayload("owner", reminders);
    assert.equal(payload.embeds[0].data.fields.length, 10);
    assert.equal(payload.components.length, 1);

    let updatedPayload;
    const nextId = payload.components[0].components[1].data.custom_id;
    const ownerInteraction = {
        customId: nextId,
        user: { id: "owner" },
        async update(value) { updatedPayload = value; },
        async reply(value) { this.replyPayload = value; }
    };
    assert.equal(await handleReminderListComponent(ownerInteraction), true);
    assert.equal(updatedPayload.embeds[0].data.fields.length, 1);
    assert.match(updatedPayload.embeds[0].data.footer.text, /Page 2 of 2/);

    const otherUserInteraction = {
        ...ownerInteraction,
        user: { id: "other-user" }
    };
    await handleReminderListComponent(otherUserInteraction);
    assert.match(otherUserInteraction.replyPayload.content, /Only the person/);
});
