const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PermissionFlagsBits } = require("discord.js");
const { MAX_TIMEOUT_MS, formatDuration, parseDuration } = require("../services/duration");
const { UserFacingError } = require("../services/errors");
const { executeModeration } = require("../services/moderation");

test("duration parser accepts supported and compound durations, rejects invalid ranges", () => {
    assert.equal(parseDuration("10s"), 10_000);
    assert.equal(parseDuration("30m"), 30 * 60_000);
    assert.equal(parseDuration("1h30m"), 90 * 60_000);
    assert.equal(parseDuration("7d"), 7 * 24 * 60 * 60_000);
    assert.equal(parseDuration("28d"), MAX_TIMEOUT_MS);
    assert.equal(parseDuration("29d"), null);
    assert.equal(parseDuration("0s"), null);
    assert.equal(parseDuration("2x"), null);
    assert.equal(parseDuration("1m 2s"), null);
    assert.equal(formatDuration(90 * 60_000), "1h 30m");
});

function createRole(position) {
    return {
        position,
        comparePositionTo(other) {
            return this.position - other.position;
        }
    };
}

function createModerationInteraction({
    actorPosition = 5,
    botPosition = 10,
    targetPosition = 1,
    permissions = [PermissionFlagsBits.KickMembers],
    targetId = "target"
} = {}) {
    const actor = { id: "moderator", roles: { highest: createRole(actorPosition) } };
    const target = {
        id: targetId,
        roles: { highest: createRole(targetPosition) },
        kick: async () => { target.kicked = true; }
    };
    const bot = { id: "bot", roles: { highest: createRole(botPosition) } };
    const members = new Map([
        ["moderator", actor],
        ["bot", bot],
        [targetId, target]
    ]);
    const guild = {
        id: "guild",
        ownerId: "owner",
        members: {
            me: bot,
            fetch: async userId => {
                const member = members.get(userId);
                if (!member) {
                    const error = new Error("Unknown member");
                    error.code = 10007;
                    throw error;
                }
                return member;
            }
        },
        bans: { fetch: async () => null, remove: async () => {} },
        channels: { fetch: async () => null }
    };
    const granted = new Set(permissions);
    return {
        actor,
        target,
        interaction: {
            guild,
            user: { id: "moderator", tag: "Moderator", toString: () => "<@moderator>" },
            client: { user: { id: "bot" } },
            memberPermissions: { has: permission => granted.has(permission) }
        }
    };
}

test("moderation succeeds when caller and bot can manage the target", async () => {
    const { interaction, target } = createModerationInteraction();
    const embed = await executeModeration(interaction, {
        action: "kick",
        user: { id: "target", tag: "Target", toString: () => "<@target>" },
        reason: "Test"
    });
    assert.equal(target.kicked, true);
    assert.equal(embed.data.title, "Moderation: kick");
});

test("moderation enforces caller permission and both hierarchy boundaries", async () => {
    const noPermission = createModerationInteraction({ permissions: [] });
    await assert.rejects(
        executeModeration(noPermission.interaction, {
            action: "kick",
            user: { id: "target" }
        }),
        UserFacingError
    );

    const callerTooLow = createModerationInteraction({ actorPosition: 1, targetPosition: 1 });
    await assert.rejects(
        executeModeration(callerTooLow.interaction, {
            action: "kick",
            user: { id: "target" }
        }),
        /equal or higher role/
    );

    const botTooLow = createModerationInteraction({ botPosition: 1, targetPosition: 1 });
    await assert.rejects(
        executeModeration(botTooLow.interaction, {
            action: "kick",
            user: { id: "target" }
        }),
        /role hierarchy/
    );

    const owner = createModerationInteraction({ targetId: "owner" });
    await assert.rejects(
        executeModeration(owner.interaction, {
            action: "kick",
            user: { id: "owner" }
        }),
        /server owner/
    );
});

test("unban supports a banned user's ID when that user is not a server member", async () => {
    const { interaction } = createModerationInteraction({
        permissions: [PermissionFlagsBits.BanMembers]
    });
    const bannedUser = {
        id: "123456789",
        username: "Banned",
        tag: "Banned#0001",
        toString: () => "<@123456789>"
    };
    let removedId;
    interaction.guild.bans.fetch = async userId => ({ user: bannedUser, id: userId });
    interaction.guild.bans.remove = async userId => { removedId = userId; };

    const embed = await executeModeration(interaction, {
        action: "unban",
        user: bannedUser.id,
        reason: "Appeal accepted"
    });
    assert.equal(removedId, bannedUser.id);
    assert.equal(embed.data.title, "Moderation: unban");
});

test("suggestion configuration, votes, and decisions persist after reloading services", () => {
    const dataDirectory = path.join(__dirname, `.phase1-data-${process.pid}`);
    const previousBotDataDir = process.env.BOT_DATA_DIR;
    const previousCountingDataDir = process.env.COUNTING_DATA_DIR;

    try {
        process.env.BOT_DATA_DIR = dataDirectory;
        delete process.env.COUNTING_DATA_DIR;
        const suggestionsPath = require.resolve("../services/suggestions");
        delete require.cache[suggestionsPath];
        let suggestions = require("../services/suggestions");

        suggestions.configureSuggestions("guild", "channel");
        const created = suggestions.createSuggestion("guild", "author", "Add a useful feature.");
        suggestions.attachSuggestionMessage("guild", created.id, "channel", "message");
        suggestions.updateSuggestion("guild", created.id, current => {
            current.votes.voter = "up";
            current.status = "approved";
            current.decision = {
                byId: "manager",
                reason: "This is useful.",
                decidedAt: new Date().toISOString()
            };
        });

        delete require.cache[suggestionsPath];
        suggestions = require("../services/suggestions");
        const config = suggestions.readGuildData("guild");
        const restored = suggestions.getSuggestion("guild", created.id);

        assert.equal(config.enabled, true);
        assert.equal(config.channelId, "channel");
        assert.equal(config.nextId, 2);
        assert.equal(restored.messageId, "message");
        assert.deepEqual(restored.votes, { voter: "up" });
        assert.equal(restored.status, "approved");
        assert.equal(restored.decision.reason, "This is useful.");
        assert.equal(suggestions.voteCounts(restored).up, 1);

        const guildSettingsPath = require.resolve("../services/guild-settings");
        delete require.cache[guildSettingsPath];
        const guildSettings = require("../services/guild-settings");
        guildSettings.setModerationLogChannel("guild", "moderation-channel");
        delete require.cache[guildSettingsPath];
        assert.equal(
            require("../services/guild-settings").getGuildSettings("guild").moderationLogChannelId,
            "moderation-channel"
        );
    } finally {
        if (previousBotDataDir === undefined) delete process.env.BOT_DATA_DIR;
        else process.env.BOT_DATA_DIR = previousBotDataDir;
        if (previousCountingDataDir === undefined) delete process.env.COUNTING_DATA_DIR;
        else process.env.COUNTING_DATA_DIR = previousCountingDataDir;
        if (fs.existsSync(dataDirectory)) {
            for (const file of fs.readdirSync(dataDirectory)) {
                fs.unlinkSync(path.join(dataDirectory, file));
            }
            fs.rmdirSync(dataDirectory);
        }
        delete require.cache[require.resolve("../services/suggestions")];
        delete require.cache[require.resolve("../services/guild-settings")];
    }
});

test("suggestion buttons persist changeable votes and one-time decisions", async () => {
    const dataDirectory = path.join(__dirname, `.phase1-components-${process.pid}`);
    const previousBotDataDir = process.env.BOT_DATA_DIR;
    try {
        process.env.BOT_DATA_DIR = dataDirectory;
        const servicePath = require.resolve("../services/suggestions");
        delete require.cache[servicePath];
        const suggestions = require("../services/suggestions");
        suggestions.configureSuggestions("guild", "suggestions-channel");
        const created = suggestions.createSuggestion("guild", "author", "A persistent proposal.");
        suggestions.attachSuggestionMessage("guild", created.id, "suggestions-channel", "message");

        let latestMessageEdit;
        const postedMessage = {
            id: "message",
            async edit(payload) { latestMessageEdit = payload; }
        };
        const client = {
            channels: {
                fetch: async () => ({
                    isTextBased: () => true,
                    isSendable: () => true,
                    messages: { fetch: async () => postedMessage }
                })
            }
        };
        const buttonInteraction = (customId, userId) => ({
            customId,
            guildId: "guild",
            user: { id: userId, bot: false },
            message: { id: "message" },
            isButton: () => true,
            isModalSubmit: () => false,
            async update(payload) { latestMessageEdit = payload; },
            async reply(payload) { this.replyPayload = payload; }
        });

        await suggestions.handleSuggestionComponent(
            buttonInteraction(`sug:vote:${created.id}:up`, "voter")
        );
        await suggestions.handleSuggestionComponent(
            buttonInteraction(`sug:vote:${created.id}:down`, "voter")
        );
        assert.deepEqual(suggestions.getSuggestion("guild", created.id).votes, { voter: "down" });

        const modal = {
            customId: `sug:decision:${created.id}:approve`,
            guildId: "guild",
            user: { id: "manager" },
            client,
            guild: {},
            fields: { getTextInputValue: () => "Accepted after review." },
            memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild },
            isButton: () => false,
            isModalSubmit: () => true,
            async deferReply() {},
            async editReply(content) { this.replyContent = content; },
            async reply(payload) { this.replyPayload = payload; }
        };
        await suggestions.handleSuggestionComponent(modal);
        const persisted = suggestions.getSuggestion("guild", created.id);
        assert.equal(persisted.status, "approved");
        assert.equal(persisted.decision.reason, "Accepted after review.");
        assert.match(modal.replyContent, /approved/);
        assert(latestMessageEdit.components
            .flatMap(row => row.components)
            .every(button => button.data.disabled));

        await suggestions.handleSuggestionComponent(modal);
        assert.match(modal.replyPayload.content, /already been decided/);
    } finally {
        if (previousBotDataDir === undefined) delete process.env.BOT_DATA_DIR;
        else process.env.BOT_DATA_DIR = previousBotDataDir;
        delete require.cache[require.resolve("../services/suggestions")];
        if (fs.existsSync(dataDirectory)) {
            for (const file of fs.readdirSync(dataDirectory)) {
                fs.unlinkSync(path.join(dataDirectory, file));
            }
            fs.rmdirSync(dataDirectory);
        }
    }
});

test("existing counting processing still advances, reacts, rejects duplicates, and preserves cheat state", async () => {
    const dataDirectory = path.join(__dirname, `.phase1-counting-${process.pid}`);
    const previousBotDataDir = process.env.BOT_DATA_DIR;
    const previousCountingDataDir = process.env.COUNTING_DATA_DIR;
    try {
        process.env.BOT_DATA_DIR = dataDirectory;
        delete process.env.COUNTING_DATA_DIR;
        const documents = new Map([["guild", {
            channelId: "counting-channel",
            currentCount: 16,
            highestCount: 16
        }]]);
        const countingPath = require.resolve("../services/counting");
        const eventsPath = require.resolve("../services/counting-events");
        delete require.cache[countingPath];
        delete require.cache[eventsPath];
        const originalLoad = Module._load;
        Module._load = function(request, parent, isMain) {
            if (request === "../db" && parent.filename === countingPath) {
                return {
                    getDB: () => ({
                        collection: () => ({
                            find: () => ({
                                toArray: async () => Array.from(
                                    documents,
                                    ([_id, data]) => ({ _id, ...data })
                                )
                            }),
                            updateOne: async ({ _id }, update) => {
                                documents.set(_id, {
                                    ...(documents.get(_id) || {}),
                                    ...update.$set
                                });
                            }
                        })
                    })
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        let counting;
        try {
            counting = require("../services/counting");
        } finally {
            Module._load = originalLoad;
        }
        const { processCountingMessage, registerCountingEvents } =
            require("../services/counting-events");
        await counting.initializeCountingData();
        assert.equal(counting.getServerData("guild").currentCount, 16);
        await counting.updateServerData("guild", data => {
            data.channelId = "counting-channel";
            data.currentCount = 17;
            data.cheatEnabled = true;
        });

        const createMessage = (content, id) => ({
            id,
            content,
            guildId: "guild",
            channelId: "counting-channel",
            author: { id, bot: false },
            guild: {},
            deleted: false,
            reactions: [],
            async delete() { this.deleted = true; },
            async react(emoji) { this.reactions.push(emoji); }
        });

        const wrong = createMessage("19", "wrong");
        await processCountingMessage(wrong);
        assert.equal(wrong.deleted, true);
        assert.equal(counting.getServerData("guild").currentCount, 17);

        const valid = createMessage("18", "valid");
        await processCountingMessage(valid);
        assert.equal(valid.reactions[0], String.fromCodePoint(0x2705));
        assert.equal(counting.getServerData("guild").currentCount, 18);

        const duplicate = createMessage("18", "duplicate");
        await processCountingMessage(duplicate);
        assert.equal(duplicate.deleted, true);
        assert.equal(counting.getServerData("guild").currentCount, 18);

        const client = new EventEmitter();
        registerCountingEvents(client);
        const rapidFirst = createMessage("19", "rapid-first");
        const rapidSecond = createMessage("19", "rapid-second");
        client.emit("messageCreate", rapidFirst);
        client.emit("messageCreate", rapidSecond);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(rapidFirst.reactions[0], String.fromCodePoint(0x2705));
        assert.equal(rapidSecond.deleted, true);
        assert.equal(counting.getServerData("guild").currentCount, 19);
        assert.equal(documents.get("guild").currentCount, 19);
    } finally {
        if (previousBotDataDir === undefined) delete process.env.BOT_DATA_DIR;
        else process.env.BOT_DATA_DIR = previousBotDataDir;
        if (previousCountingDataDir === undefined) delete process.env.COUNTING_DATA_DIR;
        else process.env.COUNTING_DATA_DIR = previousCountingDataDir;
        for (const modulePath of [
            require.resolve("../services/counting"),
            require.resolve("../services/counting-events")
        ]) {
            delete require.cache[modulePath];
        }
        if (fs.existsSync(dataDirectory)) {
            for (const file of fs.readdirSync(dataDirectory)) {
                fs.unlinkSync(path.join(dataDirectory, file));
            }
            fs.rmdirSync(dataDirectory);
        }
    }
});

test("every existing and Phase 1 slash command loads with a unique schema", () => {
    const commandDirectory = path.join(__dirname, "..", "commands");
    const names = new Set();
    for (const file of fs.readdirSync(commandDirectory).filter(name => name.endsWith(".js"))) {
        const command = require(path.join(commandDirectory, file));
        assert.equal(typeof command.execute, "function", `${file} must export execute`);
        const schema = command.data.toJSON();
        assert.equal(names.has(schema.name), false, `duplicate command ${schema.name}`);
        names.add(schema.name);
    }
    assert(names.has("counting-channel"));
    assert(names.has("suggestion"));
    assert(names.has("modlog"));
    assert(names.has("userinfo"));
    assert(names.has("timeoutes"));
});

test("counting JSON migration imports missing servers without replacing MongoDB data", async () => {
    const dataDirectory = path.join(__dirname, `.phase1-migration-${process.pid}`);
    const previousBotDataDir = process.env.BOT_DATA_DIR;
    const previousCountingDataDir = process.env.COUNTING_DATA_DIR;
    const existingDocument = { currentCount: 99 };
    const documents = new Map([["existing", existingDocument]]);
    const migrationPath = require.resolve("../migrate");
    delete require.cache[migrationPath];

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(path.join(dataDirectory, "counting.json"), JSON.stringify({
        existing: { currentCount: 8 },
        legacy: { currentCount: 12, highestCount: 12 }
    }));
    process.env.BOT_DATA_DIR = dataDirectory;
    delete process.env.COUNTING_DATA_DIR;

    const originalLoad = Module._load;
    let disconnected = false;
    Module._load = function(request, parent, isMain) {
        if (request === "./db" && parent.filename === migrationPath) {
            return {
                connectDB: async () => {},
                getDB: () => ({
                    collection: () => ({
                        bulkWrite: async operations => {
                            for (const operation of operations) {
                                const { filter, update } = operation.updateOne;
                                if (!documents.has(filter._id)) {
                                    documents.set(filter._id, update.$setOnInsert);
                                }
                            }
                        }
                    })
                }),
                closeDB: async () => { disconnected = true; }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const { migrateCountingData } = require("../migrate");
        assert.equal(await migrateCountingData(), 2);
        assert.deepEqual(documents.get("existing"), existingDocument);
        assert.deepEqual(documents.get("legacy"), {
            currentCount: 12,
            highestCount: 12
        });
        assert.equal(disconnected, true);
    } finally {
        Module._load = originalLoad;
        delete require.cache[migrationPath];
        if (previousBotDataDir === undefined) delete process.env.BOT_DATA_DIR;
        else process.env.BOT_DATA_DIR = previousBotDataDir;
        if (previousCountingDataDir === undefined) delete process.env.COUNTING_DATA_DIR;
        else process.env.COUNTING_DATA_DIR = previousCountingDataDir;
        fs.unlinkSync(path.join(dataDirectory, "counting.json"));
        fs.rmdirSync(dataDirectory);
    }
});

test("bot bootstrap connects MongoDB before registering listeners and logging in", async () => {
    const discord = require("discord.js");
    const indexPath = path.join(__dirname, "..", "index.js");
    delete require.cache[indexPath];
    let client;
    let databaseConnected = false;
    let countingInitialized = false;
    let economyInitialized = false;
    let funStorageInitialized = false;
    let channelConfigInitialized = false;
    let channelEventsRegistered = false;
    let loggedIn = false;
    class MockClient extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.user = { id: "mock-bot", tag: "MARK test" };
            client = this;
        }

        login() {
            loggedIn = true;
            return Promise.resolve();
        }
    }

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent.filename === indexPath && request === "./db") {
            return { connectDB: async () => { databaseConnected = true; } };
        }
        if (parent.filename === indexPath && request === "./services/counting") {
            return {
                initializeCountingData: async () => {
                    assert.equal(databaseConnected, true);
                    countingInitialized = true;
                }
            };
        }
        if (parent.filename === indexPath && request === "./services/economy") {
            return {
                initializeEconomyStorage: async () => {
                    assert.equal(databaseConnected, true);
                    economyInitialized = true;
                },
                startEconomyScheduler: async () => {}
            };
        }
        if (parent.filename === indexPath && request === "./services/afk") {
            return { initializeAfkStorage: async () => {} };
        }
        if (parent.filename === indexPath && request === "./services/reminder-storage") {
            return { initializeReminderStorage: async () => {} };
        }
        if (parent.filename === indexPath && request === "./services/fun-commands") {
            return {
                initializeFunStorage: async () => {
                    assert.equal(databaseConnected, true);
                    funStorageInitialized = true;
                }
            };
        }
        if (parent.filename === indexPath && request === "./services/channel-config") {
            return {
                initializeChannelConfigStorage: async () => {
                    assert.equal(databaseConnected, true);
                    channelConfigInitialized = true;
                }
            };
        }
        if (parent.filename === indexPath && request === "./services/channel-enforcer") {
            return {
                registerChannelControlEvents: registeredClient => {
                    assert.equal(registeredClient, client);
                    channelEventsRegistered = true;
                }
            };
        }
        const loaded = originalLoad.call(this, request, parent, isMain);
        return request === "discord.js"
            ? { ...loaded, Client: MockClient }
            : loaded;
    };

    try {
        require(indexPath);
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        Module._load = originalLoad;
        delete require.cache[indexPath];
    }

    assert.equal(client.commands.size, fs.readdirSync(path.join(__dirname, "..", "commands"))
        .filter(file => file.endsWith(".js")).length);
    assert(client.listenerCount("interactionCreate") > 0);
    assert(client.listenerCount("messageCreate") > 0);
    assert.equal(client.options.intents.includes(discord.GatewayIntentBits.GuildMembers), true);
    assert.equal(countingInitialized, true);
    assert.equal(economyInitialized, true);
    assert.equal(funStorageInitialized, true);
    assert.equal(channelConfigInitialized, true);
    assert.equal(channelEventsRegistered, true);
    assert.equal(loggedIn, true);
});
