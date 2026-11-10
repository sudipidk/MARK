const assert = require("node:assert/strict");
const test = require("node:test");
const { UserFacingError } = require("../services/errors");
const economy = require("../services/economy");
const {
    getStealSuccessPercent,
    calculateStealFine,
    calculateStealAmount,
    resolveCoinflip,
    getKathmanduPeriod
} = require("../services/economy-mechanics");

function getPath(document, path) {
    return path.split(".").reduce((value, key) => value?.[key], document);
}

function compare(value, condition) {
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (!condition || typeof condition !== "object" || condition instanceof Date || Array.isArray(condition)) {
        return value === condition;
    }
    return Object.entries(condition).every(([operator, expected]) => {
        if (operator === "$exists") return expected ? value !== undefined : value === undefined;
        if (operator === "$lte") return value !== undefined && value <= expected;
        if (operator === "$lt") return value !== undefined && value < expected;
        if (operator === "$gte") return value !== undefined && value >= expected;
        if (operator === "$gt") return value !== undefined && value > expected;
        if (operator === "$ne") return value !== expected;
        if (operator === "$in") return expected.includes(value);
        throw new Error(`Unsupported mock query operator: ${operator}`);
    });
}

function matches(document, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === "$or") return expected.some(child => matches(document, child));
        if (key === "$and") return expected.every(child => matches(document, child));
        return compare(getPath(document, key), expected);
    });
}

function applyUpdate(document, update, inserting = false) {
    const setPath = (path, value) => {
        const parts = path.split(".");
        const last = parts.pop();
        const parent = parts.reduce((current, part) => current[part] ||= {}, document);
        parent[last] = value;
    };
    if (inserting) {
        for (const [path, value] of Object.entries(update.$setOnInsert || {})) setPath(path, value);
    }
    for (const [path, value] of Object.entries(update.$set || {})) setPath(path, value);
    for (const [path, amount] of Object.entries(update.$inc || {})) {
        setPath(path, (getPath(document, path) || 0) + amount);
    }
}

function createMemoryDatabase() {
    const collections = new Map();
    const indexes = new Map();
    let queue = Promise.resolve();
    let failedInsertCollection = null;
    function getCollection(name) {
        if (!collections.has(name)) collections.set(name, new Map());
        if (!indexes.has(name)) indexes.set(name, new Map());
        const documents = collections.get(name);
        const collectionIndexes = indexes.get(name);
        return {
            async createIndex(key, options = {}) {
                const indexName = options.name || Object.entries(key)
                    .map(([field, direction]) => `${field}_${direction}`).join("_");
                collectionIndexes.set(indexName, { name: indexName, key: structuredClone(key), ...structuredClone(options) });
                return indexName;
            },
            listIndexes() {
                return { async toArray() { return structuredClone([...collectionIndexes.values()]); } };
            },
            async dropIndex(indexName) {
                if (!collectionIndexes.delete(indexName)) {
                    const error = new Error(`index not found: ${indexName}`);
                    error.code = 27;
                    throw error;
                }
                return { ok: 1 };
            },
            async insertOne(document) {
                if (failedInsertCollection === name) {
                    failedInsertCollection = null;
                    throw new Error("simulated database failure");
                }
                if (documents.has(document._id)) {
                    const error = new Error("duplicate key");
                    error.code = 11000;
                    throw error;
                }
                documents.set(document._id, structuredClone(document));
                return { insertedId: document._id };
            },
            async findOne(filter) {
                const document = [...documents.values()].find(value => matches(value, filter));
                return document ? structuredClone(document) : null;
            },
            async updateOne(filter, update, options = {}) {
                let document = [...documents.values()].find(value => matches(value, filter));
                if (!document && options.upsert) {
                    document = {};
                    for (const [key, value] of Object.entries(filter)) {
                        if (!key.startsWith("$") && (!value || typeof value !== "object" || value instanceof Date)) {
                            document[key] = value;
                        }
                    }
                    applyUpdate(document, update, true);
                    if (!document._id) document._id = `${Date.now()}-${Math.random()}`;
                    documents.set(document._id, document);
                    return { matchedCount: 0, upsertedCount: 1 };
                }
                if (!document) return { matchedCount: 0, modifiedCount: 0 };
                applyUpdate(document, update);
                return { matchedCount: 1, modifiedCount: 1 };
            },
            async replaceOne(filter, replacement, options = {}) {
                const entry = [...documents.entries()].find(([, value]) => matches(value, filter));
                if (entry) {
                    documents.set(entry[0], structuredClone(replacement));
                    return { matchedCount: 1, modifiedCount: 1 };
                }
                if (options.upsert) {
                    documents.set(replacement._id, structuredClone(replacement));
                    return { matchedCount: 0, upsertedCount: 1 };
                }
                return { matchedCount: 0, modifiedCount: 0 };
            },
            async deleteMany(filter) {
                let deletedCount = 0;
                for (const [key, document] of documents) {
                    if (matches(document, filter)) {
                        documents.delete(key);
                        deletedCount += 1;
                    }
                }
                return { deletedCount };
            },
            async deleteOne(filter) {
                const entry = [...documents.entries()].find(([, value]) => matches(value, filter));
                if (!entry) return { deletedCount: 0 };
                documents.delete(entry[0]);
                return { deletedCount: 1 };
            },
            async countDocuments(filter) {
                return [...documents.values()].filter(document => matches(document, filter)).length;
            },
            find(filter) {
                let results = [...documents.values()].filter(document => matches(document, filter));
                return {
                    sort(specification) {
                        const [field, direction] = Object.entries(specification)[0];
                        results.sort((left, right) => {
                            const a = getPath(left, field);
                            const b = getPath(right, field);
                            return (a < b ? -1 : a > b ? 1 : 0) * direction;
                        });
                        return this;
                    },
                    skip(count) {
                        results = results.slice(count);
                        return this;
                    },
                    limit(count) {
                        results = results.slice(0, count);
                        return this;
                    },
                    async toArray() {
                        return structuredClone(results);
                    }
                };
            },
            aggregate(pipeline) {
                let results = [...documents.values()].map(document => structuredClone(document));
                for (const stage of pipeline) {
                    if (stage.$match) results = results.filter(document => matches(document, stage.$match));
                    if (stage.$group) {
                        const keyPath = stage.$group._id.slice(1);
                        const keys = new Set(results.map(document => getPath(document, keyPath)));
                        results = [...keys].map(key => ({ _id: key }));
                    }
                }
                return { async toArray() { return structuredClone(results); } };
            }
        }
    }
    const database = {
        addIndex(collectionName, index) {
            if (!indexes.has(collectionName)) indexes.set(collectionName, new Map());
            indexes.get(collectionName).set(index.name, structuredClone(index));
        },
        getIndexes(collectionName) {
            return [...(indexes.get(collectionName)?.values() || [])].map(index => structuredClone(index));
        },
        failNextInsertFor(name) {
            failedInsertCollection = name;
        },
        documents: {
            values: () => [...collections.values()].flatMap(collection => [...collection.values()])
        },
        getDB: () => ({ collection: name => getCollection(name) }),
        getClient: () => ({
            startSession() {
                return {
                    async withTransaction(callback) {
                        const previous = queue;
                        let release;
                        queue = new Promise(resolve => { release = resolve; });
                        await previous;
                        const snapshot = new Map([...collections].map(([name, documents]) =>
                            [name, structuredClone([...documents.entries()])]));
                        try {
                            return await callback();
                        } catch (error) {
                            collections.clear();
                            for (const [name, values] of snapshot) {
                                collections.set(name, new Map(values));
                            }
                            throw error;
                        } finally {
                            release();
                        }
                    },
                    async endSession() {}
                };
            }
        })
    };
    return database;
}

function loadEconomyWithDatabase(database) {
    const resolved = require.resolve("../services/economy");
    delete require.cache[resolved];
    const originalLoad = require("node:module")._load;
    require("node:module")._load = function(request, parent, isMain) {
        if (request === "../db" && parent.filename === resolved) return database;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(resolved);
    } finally {
        require("node:module")._load = originalLoad;
    }
}

test("first interaction grants the starting balance exactly once under concurrency", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await Promise.all(Array.from({ length: 12 }, () => service.ensureAccount("guild", "user")));
    const accounts = [...database.documents.values()].filter(document =>
        document._id === "user" && document.userId === "user"
    );
    const grants = [...database.documents.values()].filter(document => document.type === "starting_balance");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].wallet, 1000);
    assert.equal(grants.length, 1);
});

test("Wordle reward credits use the global economy ledger and are idempotent per challenge", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const payment = {
        guildId: "wordle-guild",
        userId: "winner",
        challengeId: "challenge-001",
        amount: 5000
    };

    await service.creditWordleReward(payment);
    await service.creditWordleReward(payment);

    const account = database.documents.values().find(document =>
        document._id === "winner" && document.userId === "winner"
    );
    const rewards = database.documents.values().filter(document =>
        document.type === "wordle_reward"
    );
    assert.equal(account.wallet, 6000);
    assert.equal(account.stats.totalEarned, 6000);
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0]._id, "wordle:challenge-001");
    assert.equal(rewards[0].currencyIssued, 5000);
    await assert.rejects(
        service.creditWordleReward({ ...payment, amount: 7500 }),
        /different payment/
    );
});

test("economy accounts, balances, inventory, cooldowns, titles, and history are shared across guilds", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const accountFromFirstGuild = await service.getAccount("guild-one", "shared-user");
    const accountFromSecondGuild = await service.getAccount("guild-two", "shared-user");
    assert.equal(accountFromFirstGuild._id, "shared-user");
    assert.equal(accountFromSecondGuild._id, "shared-user");
    assert.equal(accountFromFirstGuild.wallet, 1000);
    assert.equal(accountFromSecondGuild.wallet, 1000);

    const daily = await service.claimReward({
        guildId: "guild-one",
        userId: "shared-user",
        operationId: "global-daily-one",
        kind: "daily",
        random: () => 0
    });
    assert.equal((await service.getAccount("guild-two", "shared-user")).wallet, daily.balance);
    await assert.rejects(
        service.claimReward({
            guildId: "guild-two",
            userId: "shared-user",
            operationId: "global-daily-two",
            kind: "daily",
            random: () => 0
        }),
        UserFacingError
    );
    assert.equal((await service.getCooldowns("guild-two", "shared-user"))[0].remainingMs > 0, true);

    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "shared-user" },
        { $set: { wallet: 1000000 } }
    );
    await service.buyItem({
        guildId: "guild-one",
        userId: "shared-user",
        itemInput: "coinflip-luck-i",
        quantity: 2,
        operationId: "global-buy-boost"
    });
    await service.buyItem({
        guildId: "guild-one",
        userId: "shared-user",
        itemInput: "phantom",
        operationId: "global-buy-title"
    });
    await service.equipTitle({
        guildId: "guild-one",
        userId: "shared-user",
        titleInput: "phantom",
        operationId: "global-equip-title"
    });
    const secondGuildInventory = await service.getInventory("guild-two", "shared-user");
    const secondGuildProfile = await service.getProfile("guild-two", "shared-user");
    const secondGuildHistory = await service.listTransactions("guild-two", "shared-user");
    assert.equal(secondGuildInventory.items.find(item => item.itemId === "coinflip-luck-i").quantity, 2);
    assert.equal(secondGuildInventory.titles.some(title => title.titleId === "phantom"), true);
    assert.equal(secondGuildInventory.equippedTitleId, "phantom");
    assert.equal(secondGuildProfile.account.wallet, (await service.getAccount("guild-one", "shared-user")).wallet);
    assert.equal(secondGuildProfile.titleCompletion > 0, true);
    assert(secondGuildHistory.some(transaction => transaction.relatedItemId === "phantom"));
});

test("legacy per-guild records migrate with a documented balance-preserving merge and archives", async () => {
    const database = createMemoryDatabase();
    const resolved = require.resolve("../services/economy");
    const service = loadEconomyWithDatabase(database);
    const legacyAccounts = database.getDB().collection("economyAccounts");
    const legacyInventory = database.getDB().collection("economyInventory");
    const legacyTitles = database.getDB().collection("economyTitles");
    await legacyAccounts.insertOne({
        _id: "guild-one:legacy-user",
        guildId: "guild-one",
        userId: "legacy-user",
        wallet: 1200,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        equippedTitleId: "phantom",
        cooldowns: { daily: new Date("2026-10-09T00:00:00Z") },
        stats: { totalEarned: 1200, totalSpent: 20 }
    });
    await legacyAccounts.insertOne({
        _id: "guild-two:legacy-user",
        guildId: "guild-two",
        userId: "legacy-user",
        wallet: 800,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        equippedTitleId: "royal",
        cooldowns: { daily: new Date("2026-10-10T00:00:00Z") },
        stats: { totalEarned: 800, totalSpent: 10 }
    });
    await legacyInventory.insertOne({
        _id: "guild-one:legacy-user:bodyguard",
        guildId: "guild-one",
        userId: "legacy-user",
        itemId: "bodyguard",
        quantity: 2
    });
    await legacyInventory.insertOne({
        _id: "guild-two:legacy-user:bodyguard",
        guildId: "guild-two",
        userId: "legacy-user",
        itemId: "bodyguard",
        quantity: 3
    });
    await legacyTitles.insertOne({
        _id: "guild-one:legacy-user:phantom",
        guildId: "guild-one",
        userId: "legacy-user",
        titleId: "phantom",
        purchasedAt: new Date("2026-01-01T00:00:00Z")
    });

    await service.initializeEconomyStorage();

    const account = await service.getAccount("guild-three", "legacy-user");
    assert.equal(account._id, "legacy-user");
    assert.equal(account.wallet, 2000);
    assert.equal(account.stats.totalSpent, 30);
    assert.equal(account.equippedTitleId, "phantom");
    assert.equal(new Date(account.cooldowns.daily).toISOString(), "2026-10-10T00:00:00.000Z");
    assert.equal((await service.getInventory("guild-three", "legacy-user")).items[0].quantity, 5);
    assert.equal((await service.getInventory("guild-three", "legacy-user")).titles[0].titleId, "phantom");
    assert.equal(database.documents.values().filter(document => document.sourceCollection).length, 5);
    const migration = await database.getDB().collection("economyMigrations").findOne({ _id: "global-economy-userid-v1" });
    assert.equal(migration.walletStrategy, "sum all per-guild wallet balances to preserve recorded coins");
    assert.equal(database.documents.values().filter(document => document.guildId && document.userId === "legacy-user" && document.wallet).length, 0);
    delete require.cache[resolved];
});

test("Avenger ownership migrates without duplicate Ones Above All ownership or lost archive data", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const titles = database.getDB().collection("economyTitles");
    const accounts = database.getDB().collection("economyAccounts");
    await titles.insertOne({
        _id: "legacy-avenger-user",
        userId: "legacy-user",
        titleId: "avenger",
        purchasedAt: new Date("2025-01-01T00:00:00Z")
    });
    await titles.insertOne({
        _id: "legacy-avenger-duplicate",
        userId: "duplicate-user",
        titleId: "avenger",
        purchasedAt: new Date("2025-01-01T00:00:00Z")
    });
    await titles.insertOne({
        _id: "current-ones-above-all",
        userId: "duplicate-user",
        titleId: "ones-above-all",
        purchasedAt: new Date("2026-01-01T00:00:00Z")
    });
    await accounts.insertOne({
        _id: "legacy-user",
        userId: "legacy-user",
        bot: false,
        wallet: 1000,
        equippedTitleId: "avenger",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        stats: {}
    });

    await service.initializeEconomyStorage();

    const owned = await titles.find({ userId: { $in: ["legacy-user", "duplicate-user"] } }).toArray();
    assert.equal(owned.filter(title => title.userId === "legacy-user")[0].titleId, "ones-above-all");
    assert.equal(owned.filter(title => title.userId === "duplicate-user" && title.titleId === "ones-above-all").length, 1);
    assert.equal((await accounts.findOne({ _id: "legacy-user" })).equippedTitleId, "ones-above-all");
    const archived = await database.getDB().collection("economyMigrations")
        .find({ _id: "avenger-title-duplicate:legacy-avenger-duplicate" }).toArray();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].sourceOwnership.titleId, "avenger");
});

test("concurrent daily claims grant one reward and persisted cooldown survives service reload", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const results = await Promise.allSettled([
        service.claimReward({ guildId: "guild", userId: "user", operationId: "claim-a", kind: "daily" }),
        service.claimReward({ guildId: "guild", userId: "user", operationId: "claim-b", kind: "daily" })
    ]);
    const success = results.filter(result => result.status === "fulfilled");
    const failure = results.find(result => result.status === "rejected");
    assert.equal(success.length, 1);
    assert(failure.reason instanceof UserFacingError);
    const accountBeforeReload = [...database.documents.values()].find(document => document.userId === "user");
    const balanceBeforeReload = accountBeforeReload.wallet;
    assert(balanceBeforeReload >= 1500 && balanceBeforeReload <= 2000);

    const reloaded = loadEconomyWithDatabase(database);
    await assert.rejects(
        reloaded.claimReward({ guildId: "guild", userId: "user", operationId: "claim-c", kind: "daily" }),
        UserFacingError
    );
    assert.equal([...database.documents.values()].find(document => document.userId === "user").wallet, balanceBeforeReload);
});

test("an interaction retry returns its committed result without granting twice", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const action = { guildId: "guild", userId: "user", operationId: "same-interaction", kind: "weekly" };
    const [first, retry] = await Promise.all([
        service.claimReward(action),
        service.claimReward(action)
    ]);
    assert.equal(first.reward, retry.reward);
    assert.equal(first.balance, retry.balance);
    assert.equal([...database.documents.values()].filter(document => document.type === "weekly").length, 1);
});

test("transfers are atomic, and conditional debits prevent negative wallets", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "sender");
    await service.ensureAccount("guild", "recipient");
    const receipt = await service.transfer({
        guildId: "guild",
        fromUserId: "sender",
        toUserId: "recipient",
        amount: 700,
        operationId: "transfer-1"
    });
    assert.equal(receipt.balance, 300);
    await assert.rejects(
        service.transfer({
            guildId: "guild",
            fromUserId: "sender",
            toUserId: "recipient",
            amount: 400,
            operationId: "transfer-2"
        }),
        UserFacingError
    );
    const sender = await service.getExistingAccount("guild", "sender");
    const recipient = await service.getExistingAccount("guild", "recipient");
    assert.equal(sender.wallet, 300);
    assert.equal(recipient.wallet, 1700);
    assert(sender.wallet >= 0);
});

test("concurrent transfers cannot spend the same wallet balance twice", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "sender");
    await service.ensureAccount("guild", "left");
    await service.ensureAccount("guild", "right");
    const results = await Promise.allSettled([
        service.transfer({
            guildId: "guild", fromUserId: "sender", toUserId: "left", amount: 700, operationId: "parallel-left"
        }),
        service.transfer({
            guildId: "guild", fromUserId: "sender", toUserId: "right", amount: 700, operationId: "parallel-right"
        })
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await service.getExistingAccount("guild", "sender")).wallet, 300);
});

test("failed steals transfer the exact fine once; success transfers a capped target percentage", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const deterministic = values => maximum => {
        const value = values.shift();
        assert(value >= 0 && value < maximum);
        return value;
    };
    const failed = await service.steal({
        guildId: "guild",
        thiefId: "thief",
        targetId: "victim",
        operationId: "failed-steal",
        random: deterministic([99, 0])
    });
    assert.equal(failed.succeeded, false);
    assert.equal(failed.amount, 250);
    assert.equal((await service.getExistingAccount("guild", "thief")).wallet, 750);
    assert.equal((await service.getExistingAccount("guild", "victim")).wallet, 1250);
    const retry = await service.steal({
        guildId: "guild",
        thiefId: "thief",
        targetId: "victim",
        operationId: "failed-steal",
        random: deterministic([99, 0])
    });
    assert.equal(retry.amount, 250);
    assert.equal((await service.getExistingAccount("guild", "victim")).wallet, 1250);

    await service.ensureAccount("guild", "guarded-target");
    await database.getDB().collection("economyEffects").insertOne({
        _id: "guarded-target-active-guard",
        guildId: "guild",
        userId: "guarded-target",
        effectType: "bodyguard",
        expiresAt: new Date(Date.now() + 60000)
    });
    const guarded = await service.steal({
        guildId: "guild",
        thiefId: "guarded-thief",
        targetId: "guarded-target",
        operationId: "guarded-steal",
        random: deterministic([25, 0])
    });
    assert.equal(guarded.guards, 1);
    assert.equal(guarded.successPercent, 25);
    assert.equal(guarded.succeeded, false);

    const successful = await service.steal({
        guildId: "guild",
        thiefId: "successful-thief",
        targetId: "successful-target",
        operationId: "successful-steal",
        random: deterministic([29, 10])
    });
    assert.equal(successful.succeeded, true);
    assert.equal(successful.amount, 150);
    assert.equal((await service.getExistingAccount("guild", "successful-thief")).wallet, 1150);
    assert.equal((await service.getExistingAccount("guild", "successful-target")).wallet, 850);
});

test("shop purchase rollback keeps the wallet intact when the item grant fails", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "buyer");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "buyer" },
        { $set: { wallet: 10000 } }
    );
    database.failNextInsertFor("economyTransactions");
    await assert.rejects(
        service.buyItem({
            guildId: "guild", userId: "buyer", itemInput: "coinflip-luck-i", operationId: "broken-purchase"
        }),
        /simulated database failure/
    );
    assert.equal((await service.getExistingAccount("guild", "buyer")).wallet, 10000);
    assert.equal(await database.getDB().collection("economyInventory").findOne({
        userId: "buyer", itemId: "coinflip-luck-i"
    }), null);
});

test("luck effects stack independently and apply the strongest active chance", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "user");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "user" },
        { $set: { wallet: 100000 } }
    );
    await service.buyItem({
        guildId: "guild", userId: "user", itemInput: "coinflip-luck-i", quantity: 2, operationId: "buy-luck-i"
    });
    await service.buyItem({
        guildId: "guild", userId: "user", itemInput: "coinflip-luck-ii", operationId: "buy-luck-ii"
    });
    const firstI = await service.useItem({
        guildId: "guild", userId: "user", itemInput: "coinflip-luck-i", quantity: 1, operationId: "use-luck-i-a"
    });
    const secondI = await service.useItem({
        guildId: "guild", userId: "user", itemInput: "coinflip-luck-i", quantity: 1, operationId: "use-luck-i-b"
    });
    const luckII = await service.useItem({
        guildId: "guild", userId: "user", itemInput: "coinflip-luck-ii", operationId: "use-luck-ii"
    });
    assert(secondI.expiresAt.getTime() >= firstI.expiresAt.getTime() + 5 * 60 * 1000);
    assert.equal(luckII.item.id, "coinflip-luck-ii");
    assert.equal((await service.getBoosts("guild", "user")).effectiveCoinflipPercent, 63);
    const effects = [...database.documents.values()].filter(document => document.userId === "user" && document.effectType?.startsWith("coinflip"));
    assert.equal(effects.length, 2);
});

test("bodyguards enforce the active cap and expired guards stop counting", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "user");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "user" },
        { $set: { wallet: 100000 } }
    );
    await service.buyItem({
        guildId: "guild", userId: "user", itemInput: "bodyguard", quantity: 4, operationId: "buy-four-guards"
    });
    for (let index = 1; index <= 3; index += 1) {
        await service.useItem({
            guildId: "guild", userId: "user", itemInput: "bodyguard", operationId: `activate-guard-${index}`
        });
    }
    await assert.rejects(
        service.useItem({
            guildId: "guild", userId: "user", itemInput: "bodyguard", operationId: "activate-guard-4"
        }),
        UserFacingError
    );
    let boosts = await service.getBoosts("guild", "user");
    assert.equal(boosts.guards.length, 3);
    const guard = [...database.documents.values()].find(document =>
        document.userId === "user" && document.effectType === "bodyguard"
    );
    await database.getDB().collection("economyEffects").updateOne(
        { _id: guard._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    boosts = await service.getBoosts("guild", "user");
    assert.equal(boosts.guards.length, 2);
    await service.useItem({
        guildId: "guild", userId: "user", itemInput: "bodyguard", operationId: "activate-after-expiry"
    });
    assert.equal((await service.getBoosts("guild", "user")).guards.length, 3);
});

test("limited stock purchase is atomic and cannot oversell the weekly allocation", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "first");
    await service.ensureAccount("guild", "second");
    for (const userId of ["first", "second"]) {
        await database.getDB().collection("economyAccounts").updateOne(
            { _id: userId },
            { $set: { wallet: 100000 } }
        );
    }
    const results = await Promise.allSettled([
        service.buyItem({ guildId: "guild", userId: "first", itemInput: "agent", operationId: "buy-agent-a" }),
        service.buyItem({ guildId: "guild", userId: "second", itemInput: "agent", operationId: "buy-agent-b" }),
        service.buyItem({ guildId: "guild", userId: "first", itemInput: "agent", operationId: "buy-agent-c" })
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
    const stock = [...database.documents.values()].find(document => document.itemId === "agent" && document.available !== undefined);
    assert.equal(stock.available, 0);
    assert.equal(stock.sold, 2);
});

test("lottery finalization pays one cryptographically selected participant once", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.enterLottery({ guildId: "guild", userId: "participant", operationId: "ticket-1" });
    const round = [...database.documents.values()].find(document => document.guildId === "guild" && document.state === "open");
    await database.getDB().collection("economyLotteryRounds").updateOne(
        { _id: round._id },
        { $set: { endAt: new Date(Date.now() - 1000) } }
    );
    await service.finalizeExpiredLotteryRounds();
    await service.finalizeExpiredLotteryRounds();
    const completed = await database.getDB().collection("economyLotteryRounds").findOne({ _id: round._id });
    const participant = await service.getExistingAccount("guild", "participant");
    const payouts = [...database.documents.values()].filter(document => document.type === "lottery_payout");
    assert.equal(completed.state, "complete");
    assert.equal(completed.winnerUserId, "participant");
    assert.equal(participant.wallet, 1000);
    assert.equal(payouts.length, 1);
});

test("titles remain owned, equip independently, and can be sold only when eligible", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "collector");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "collector" },
        { $set: { wallet: 10000 } }
    );
    await service.buyItem({
        guildId: "guild", userId: "collector", itemInput: "phantom", operationId: "buy-phantom"
    });
    await assert.rejects(
        service.buyItem({
            guildId: "guild", userId: "collector", itemInput: "phantom", operationId: "buy-phantom-again"
        }),
        UserFacingError
    );
    await service.equipTitle({
        guildId: "guild", userId: "collector", titleInput: "phantom", operationId: "equip-phantom"
    });
    assert.equal((await service.getExistingAccount("guild", "collector")).equippedTitleId, "phantom");
    await service.sellItem({
        guildId: "guild", userId: "collector", itemInput: "phantom", operationId: "sell-phantom"
    });
    const account = await service.getExistingAccount("guild", "collector");
    assert.equal(account.wallet, 7500);
    assert.equal(account.equippedTitleId, null);
    assert.equal(await database.getDB().collection("economyTitles").findOne({
        userId: "collector", titleId: "phantom"
    }), null);
    await assert.rejects(
        service.sellItem({
            guildId: "guild", userId: "collector", itemInput: "agent", operationId: "sell-agent"
        }),
        UserFacingError
    );
});

test("title indexes migrate the obsolete partial index and allow multiple unique Variant titles", async () => {
    const database = createMemoryDatabase();
    database.addIndex("economyTitles", {
        name: "userId_1_titleId_1",
        key: { userId: 1, titleId: 1 },
        unique: true,
        partialFilterExpression: { variantCode: { $exists: false } }
    });
    database.addIndex("economyTitles", {
        name: "unrelated_title_index",
        key: { purchasedAt: 1 }
    });
    const service = loadEconomyWithDatabase(database);

    await service.initializeEconomyStorage();
    await service.initializeEconomyStorage();

    const indexes = database.getIndexes("economyTitles");
    assert.equal(indexes.some(index => index.name === "userId_1_titleId_1"), false);
    assert.equal(indexes.some(index => index.name === "unrelated_title_index"), true);
    const ownershipIndex = indexes.find(index => index.name === "userId_1_titleId_1_variantCode_1");
    assert.deepEqual(ownershipIndex.key, { userId: 1, titleId: 1, variantCode: 1 });
    assert.equal(ownershipIndex.unique, true);
    assert.equal(ownershipIndex.partialFilterExpression, undefined);

    await service.ensureAccount("guild", "variant-collector");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "variant-collector" },
        { $set: { wallet: 2000000 } }
    );
    await service.buyItem({
        guildId: "guild-one",
        userId: "variant-collector",
        itemInput: "variant",
        operationId: "buy-variant-one"
    });
    await service.buyItem({
        guildId: "guild-two",
        userId: "variant-collector",
        itemInput: "variant",
        operationId: "buy-variant-two"
    });
    const variants = await database.getDB().collection("economyTitles").find({
        userId: "variant-collector",
        titleId: "variant"
    }).toArray();
    assert.equal(variants.length, 2);
    assert.notEqual(variants[0].variantCode, variants[1].variantCode);
    assert(variants.every(title => /^[A-Z0-9]{5}$/.test(title.variantCode)));
});

test("Variant codes are five uppercase alphanumeric characters from an injectable generator", () => {
    let next = 0;
    const first = economy.createVariantCode(maximum => next++ % maximum);
    const second = economy.createVariantCode(maximum => next++ % maximum);
    assert.match(first, /^[A-Z0-9]{5}$/);
    assert.match(second, /^[A-Z0-9]{5}$/);
    assert.notEqual(first, second);
});

test("transaction history is shared across guilds, scoped to the requesting member, and supports pages", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.transfer({
        guildId: "guild", fromUserId: "sender", toUserId: "recipient", amount: 50, operationId: "history-transfer"
    });
    const senderTransactions = await service.listTransactions("guild", "sender");
    const recipientTransactions = await service.listTransactions("guild", "recipient");
    const otherGuildTransactions = await service.listTransactions("other-guild", "sender");
    assert.equal(senderTransactions.length, 2);
    assert.equal(recipientTransactions.length, 2);
    assert(senderTransactions.some(transaction => transaction.counterpartyUserId === "recipient"));
    assert(recipientTransactions.some(transaction => transaction.counterpartyUserId === "sender"));
    assert.equal(otherGuildTransactions.length, senderTransactions.length);
    assert.equal((await service.listTransactions("other-guild", "sender", 0, 1)).length, 1);
});
test("steal fine uses exactly 25% of the pre-fine wallet and bodyguard probabilities are fixed", () => {
    assert.equal(calculateStealFine(10000), 2500);
    assert.equal(calculateStealFine(503), 125);
    assert.equal(calculateStealFine(3), 0);
    assert.deepEqual([0, 1, 2, 3, 4].map(getStealSuccessPercent), [30, 25, 10, 5, 5]);
    assert.equal(calculateStealAmount(100000, 15), 10000);
    assert.equal(calculateStealAmount(100, 5), 5);
});

test("coinflip boost thresholds and double-stake payout are exact", () => {
    assert.deepEqual(resolveCoinflip(49, 50, 100), { won: true, payout: 200, net: 100 });
    assert.deepEqual(resolveCoinflip(50, 50, 100), { won: false, payout: 0, net: -100 });
    assert.equal(resolveCoinflip(55, 56, 100).won, true);
    assert.equal(resolveCoinflip(56, 56, 100).won, false);
    assert.equal(resolveCoinflip(62, 63, 100).won, true);
    assert.equal(resolveCoinflip(63, 63, 100).won, false);
});

test("coinflip validates a chosen side, pays twice the wager, and records wins and losses", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild-one", "flipper");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "flipper" },
        { $set: { wallet: 5000 } }
    );

    for (const stake of [0, -1, 1.5, NaN, Infinity]) {
        await assert.rejects(
            service.coinflip({
                guildId: "guild-one", userId: "flipper", stake, choice: "heads", operationId: `invalid-${stake}`
            }),
            UserFacingError
        );
    }
    await assert.rejects(
        service.coinflip({
            guildId: "guild-one", userId: "flipper", stake: 1, choice: "coin", operationId: "invalid-choice"
        }),
        UserFacingError
    );

    const win = await service.coinflip({
        guildId: "guild-one", userId: "flipper", stake: 500, choice: "heads",
        operationId: "coinflip-win", random: () => 0
    });
    assert.deepEqual(
        { won: win.won, choice: win.choice, result: win.result, payout: win.payout, balance: win.balance },
        { won: true, choice: "heads", result: "heads", payout: 1000, balance: 5500 }
    );
    const loss = await service.coinflip({
        guildId: "guild-two", userId: "flipper", stake: 200, choice: "heads",
        operationId: "coinflip-loss", random: () => 99
    });
    assert.deepEqual(
        { won: loss.won, choice: loss.choice, result: loss.result, payout: loss.payout, balance: loss.balance },
        { won: false, choice: "heads", result: "tails", payout: 0, balance: 5300 }
    );
    const history = await service.listTransactions("guild-three", "flipper");
    assert.equal(history.filter(transaction => transaction.type === "coinflip").length, 2);
    const winRecord = history.find(transaction => transaction._id === "coinflip-win");
    assert.equal(winRecord.balanceAfter, 5500);
    assert.deepEqual(
        { choice: winRecord.metadata.choice, result: winRecord.metadata.result },
        { choice: "heads", result: "heads" }
    );
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "flipper" },
        { $set: { wallet: Number.MAX_SAFE_INTEGER } }
    );
    await assert.rejects(
        service.coinflip({
            guildId: "guild-one",
            userId: "flipper",
            stake: Number.MAX_SAFE_INTEGER,
            choice: "heads",
            operationId: "overflowing-payout",
            random: () => 0
        }),
        UserFacingError
    );
    assert.equal(
        (await service.getExistingAccount("guild-one", "flipper")).wallet,
        Number.MAX_SAFE_INTEGER
    );
});

test("coinflip wagers honor global luck boosts and process concurrent/retried wagers once", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild-one", "lucky-flipper");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "lucky-flipper" },
        { $set: { wallet: 1000 } }
    );
    await database.getDB().collection("economyEffects").insertOne({
        _id: "lucky-flipper:luck",
        userId: "lucky-flipper",
        effectType: "coinflip-luck-i",
        expiresAt: new Date(Date.now() + 60_000)
    });
    const boosted = await service.coinflip({
        guildId: "guild-two",
        userId: "lucky-flipper",
        stake: 100,
        choice: "tails",
        operationId: "boosted-flip",
        random: () => 55
    });
    assert.equal(boosted.winPercent, 56);
    assert.equal(boosted.won, true);
    assert.equal(boosted.result, "tails");

    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "lucky-flipper" },
        { $set: { wallet: 1000 } }
    );
    await database.getDB().collection("economyEffects").updateOne(
        { _id: "lucky-flipper:luck" },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const wagers = await Promise.allSettled([
        service.coinflip({
            guildId: "guild-one", userId: "lucky-flipper", stake: 700, choice: "heads",
            operationId: "concurrent-flip-one", random: () => 99
        }),
        service.coinflip({
            guildId: "guild-two", userId: "lucky-flipper", stake: 700, choice: "heads",
            operationId: "concurrent-flip-two", random: () => 99
        })
    ]);
    assert.equal(wagers.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await service.getExistingAccount("guild-three", "lucky-flipper")).wallet, 300);

    const [first, retry] = await Promise.all([
        service.coinflip({
            guildId: "guild-one", userId: "lucky-flipper", stake: 100, choice: "tails",
            operationId: "retry-flip", random: () => 99
        }),
        service.coinflip({
            guildId: "guild-one", userId: "lucky-flipper", stake: 100, choice: "tails",
            operationId: "retry-flip", random: () => 0
        })
    ]);
    assert.deepEqual(retry, first);
    assert.equal([...database.documents.values()].filter(document =>
        document._id === "retry-flip" && document.type === "coinflip"
    ).length, 1);
});

test("bank deposits use separate 12-hour lots, charge fees on top, and credit the fee recipient", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const now = new Date("2026-10-01T00:00:00.000Z");
    await service.ensureAccount("guild", "bank-user", now);
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "bank-user" },
        { $set: { wallet: 30000 } }
    );

    const deposit = await service.depositToBank({
        guildId: "guild",
        userId: "bank-user",
        amount: 20000,
        operationId: "bank-deposit-1",
        now
    });
    assert.equal(deposit.principal, 20000);
    assert.equal(deposit.fee, 400);
    assert.equal(deposit.totalDeduction, 20400);
    assert.equal(new Date(deposit.unlockAt).getTime() - now.getTime(), 12 * 60 * 60 * 1000);
    assert.equal((await service.getAccount("guild", "bank-user")).wallet, 9600);
    assert.equal((await service.getAccount("guild", "1262703637579305063")).wallet, 1400);

    const withdrawal = await service.withdrawFromBank({
        guildId: "guild",
        userId: "bank-user",
        amount: 10001,
        operationId: "bank-withdraw-1",
        now: new Date(now.getTime() + 13 * 60 * 60 * 1000)
    });
    assert.equal(withdrawal.fee, 100);
    assert.equal(withdrawal.net, 9901);
    assert.equal(withdrawal.bankBalance, 9999);
    assert.equal((await service.getAccount("guild", "bank-user")).wallet, 34501);
    assert.equal((await service.getAccount("guild", "1262703637579305063")).wallet, 1500);
    const history = await service.listBankHistory("guild", "bank-user");
    assert.deepEqual(history.map(transaction => transaction.type), ["bank_withdrawal", "bank_deposit"]);
    assert.equal(history[1].metadata.feeRecipientUserId, "1262703637579305063");
});

test("bank deposit preview requires an owner-bound confirmation before charging fees", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const now = new Date("2026-10-01T00:00:00.000Z");
    await service.ensureAccount("guild", "preview-user", now);
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "preview-user" },
        { $set: { wallet: 11000 } }
    );

    const preview = await service.requestBankDeposit({
        guildId: "guild",
        userId: "preview-user",
        amount: 10000,
        now
    });
    assert.equal(preview.fee, 200);
    assert.equal(preview.totalDeduction, 10200);
    assert.equal((await service.getAccount("guild", "preview-user")).wallet, 11000);
    await assert.rejects(service.confirmBankDeposit({
        userId: "another-user",
        token: preview.token,
        amount: 10000,
        now
    }), UserFacingError);
    await assert.rejects(service.confirmBankDeposit({
        userId: "preview-user",
        token: preview.token,
        amount: 9999,
        now
    }), UserFacingError);

    const deposit = await service.confirmBankDeposit({
        userId: "preview-user",
        token: preview.token,
        amount: 10000,
        now: new Date(now.getTime() + 1000)
    });
    assert.equal(deposit.fee, 200);
    assert.equal((await service.getAccount("guild", "preview-user")).wallet, 800);
    await assert.rejects(service.confirmBankDeposit({
        userId: "preview-user",
        token: preview.token,
        amount: 10000,
        now: new Date(now.getTime() + 2000)
    }), UserFacingError);
});

test("number lottery draws distinct numbers, pays stake-inclusive prizes, and is idempotent", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    const account = await service.ensureAccount("guild", "lottery-user");
    assert.equal(account.wallet, 1000);
    const rolls = [7, 2, 9];
    let randomCalls = 0;
    const winning = await service.playNumberLottery({
        guildId: "guild",
        userId: "lottery-user",
        number: 7,
        amount: 100,
        operationId: "number-lottery-win",
        random: () => {
            randomCalls++;
            return rolls.shift();
        }
    });
    assert.deepEqual(winning.winningNumbers, [7, 2, 9]);
    assert.equal(winning.multiplier, 2);
    assert.equal(winning.payout, 200);
    assert.equal(winning.net, 100);
    assert.equal(winning.balance, 1100);
    assert.equal(randomCalls, 3);
    const retry = await service.playNumberLottery({
        guildId: "guild",
        userId: "lottery-user",
        number: 7,
        amount: 100,
        operationId: "number-lottery-win",
        random: () => {
            randomCalls++;
            return 1;
        }
    });
    assert.deepEqual(retry, winning);
    assert.equal(randomCalls, 3);

    const lossRolls = [2, 3, 4];
    const losing = await service.playNumberLottery({
        guildId: "guild",
        userId: "lottery-user",
        number: 1,
        amount: 100,
        operationId: "number-lottery-loss",
        random: () => lossRolls.shift()
    });
    assert.equal(losing.won, false);
    assert.equal(losing.payout, 0);
    assert.equal(losing.balance, 1000);
});

test("admin wallet actions require the exact admin ID and global resets require scoped confirmation", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await assert.rejects(service.adminWalletChange({
        guildId: "guild",
        adminUserId: "not-admin",
        targetUserId: "target",
        action: "add",
        amount: 100,
        operationId: "unauthorized-money"
    }), UserFacingError);

    await service.ensureAccount("guild", "target");
    await service.ensureAccount("guild", "second-target");
    const added = await service.adminWalletChange({
        guildId: "guild",
        adminUserId: "1262703637579305063",
        targetUserId: "target",
        action: "add",
        amount: 500,
        operationId: "admin-add"
    });
    assert.equal(added.balanceAfter, 1500);
    await assert.rejects(service.adminWalletChange({
        guildId: "guild",
        adminUserId: "1262703637579305063",
        targetUserId: "target",
        action: "remove",
        amount: 2000,
        operationId: "admin-remove-too-much"
    }), UserFacingError);

    const preview = await service.requestBalanceReset({
        guildId: "guild",
        adminUserId: "1262703637579305063"
    });
    assert.equal(preview.scope, "global");
    assert.equal(preview.affectedAccountCount, 2);
    await assert.rejects(service.confirmBalanceReset({
        guildId: "guild",
        adminUserId: "another-admin",
        token: preview.token,
        scope: "global",
        operationId: "reset-not-owner"
    }), UserFacingError);
    const reset = await service.confirmBalanceReset({
        guildId: "guild",
        adminUserId: "1262703637579305063",
        token: preview.token,
        scope: "global",
        operationId: "global-reset"
    });
    assert.equal(reset.affectedAccountCount, 2);
    assert.equal((await service.getAccount("guild", "target")).wallet, 1000);
    assert.equal((await service.getAccount("guild", "second-target")).wallet, 1000);
    assert.equal(database.documents.values().some(document =>
        document.type === "admin_wallet_reset" && document.actorUserId === "target"
    ), true);
    assert.equal(database.documents.values().some(document =>
        document.scope === "global" && document.adminUserId === "1262703637579305063"
    ), true);
    assert.equal(await database.getDB().collection("economyAdminConfirmations").findOne({ _id: preview.token }), null);
});

test("achievement rewards, exclusive tags, progress, and claims persist exactly once", async () => {
    const database = createMemoryDatabase();
    const service = loadEconomyWithDatabase(database);
    await service.ensureAccount("guild", "achievement-user");
    await database.getDB().collection("economyAccounts").updateOne(
        { _id: "achievement-user" },
        { $set: { wallet: 10000 } }
    );
    const first = await service.getAchievementSummary("guild", "achievement-user");
    assert.equal(first.earnedCount, 1);
    assert.equal(first.completionPercent, Math.round(100 / first.total));
    assert.equal(first.strongest[0].id, "first-fortune");
    assert.equal(first.progress["first-fortune"].current, 10000);
    let account = await service.getAccount("guild", "achievement-user");
    assert.equal(account.wallet, 15000);
    assert.deepEqual(account.achievements.unlocked, ["first-fortune"]);
    assert.deepEqual(account.achievements.claimed, ["first-fortune"]);
    assert.equal(await database.getDB().collection("economyTitles").findOne({
        userId: "achievement-user",
        titleId: "poor-boi"
    }) !== null, true);

    await Promise.all([
        service.getAchievementSummary("guild", "achievement-user"),
        service.getAchievementSummary("guild", "achievement-user")
    ]);
    account = await service.getAccount("guild", "achievement-user");
    assert.equal(account.wallet, 15000);
    assert.equal(database.documents.values().filter(document =>
        document.type === "achievement_reward" && document.metadata?.achievementId === "first-fortune"
    ).length, 1);
});

test("weekly stock and daily lottery periods switch at midnight Nepal Time", () => {
    const beforeMidnight = new Date("2026-10-11T18:14:59.000Z");
    const atMidnight = new Date("2026-10-11T18:15:00.000Z");
    const previousWeek = getKathmanduPeriod(beforeMidnight, true);
    const newWeek = getKathmanduPeriod(atMidnight, true);
    assert.equal(previousWeek.periodId, "2026-10-05");
    assert.equal(newWeek.periodId, "2026-10-12");
    assert.equal(newWeek.startAt.toISOString(), "2026-10-11T18:15:00.000Z");
    assert.equal(getKathmanduPeriod(atMidnight).periodId, "2026-10-12");
});
