const { randomInt, randomUUID } = require("node:crypto");
const { getDB, getClient } = require("../db");
const { UserFacingError } = require("./errors");
const config = require("./economy-config");
const { catalog, titles, consumables, getCatalogItem } = require("./economy-catalog");
const {
    getStealSuccessPercent,
    calculateStealFine,
    calculateStealAmount,
    resolveCoinflip,
    getKathmanduPeriod
} = require("./economy-mechanics");

const COINFLIP_CHANCES = Object.freeze({ "coinflip-luck-i": 56, "coinflip-luck-ii": 63 });
const BANK_FEE_RECIPIENT_ID = "1262703637579305063";
const ECONOMY_ADMIN_ID = "1262703637579305063";
const titleTypes = titles.length;

function accountId(userId) {
    return userId;
}

async function ownsItem(_guildId, userId, item) {
    const collections = getCollections();
    return item.category === "title"
        ? collections.titles.findOne({ userId, titleId: item.id })
        : collections.inventory.findOne({
            userId,
            itemId: item.id,
            quantity: { $gt: 0 }
        });
}

function newAccount(guildId, userId, now) {
    return {
        _id: userId,
        userId,
        bot: false,
        wallet: config.startingBalance,
        bank: {
            balance: 0,
            totalDeposits: 0,
            totalWithdrawals: 0,
            totalFeesPaid: 0,
            totalDepositFeesPaid: 0,
            totalWithdrawalFeesPaid: 0,
            lots: [],
            depositPeriodId: "",
            depositCount: 0
        },
        createdAt: now,
        cooldowns: {},
        stats: {
            totalEarned: config.startingBalance,
            totalSpent: 0,
            totalTransferred: 0,
            totalReceived: 0,
            totalStolen: 0,
            successfulSteals: 0,
            failedSteals: 0,
            stealFinesPaid: 0,
            stealFinesReceived: 0,
            gamblingWins: 0,
            gamblingLosses: 0,
            coinflipBets: 0,
            coinflipWins: 0,
            coinflipLosses: 0,
            lotteryBets: 0,
            lotteryWins: 0,
            consecutiveGamblingLosses: 0,
            comebackWins: 0,
            highRollerWins: 0,
            biggestLotteryPayout: 0,
            workActions: 0,
            dailyClaims: 0,
            weeklyClaims: 0,
            coinsGiven: 0,
            transfersGiven: 0,
            robberyVictimCount: 0,
            protectedAvoidances: 0,
            longTermSavedWithdrawals: 0,
            feeFreeWithdrawals: 0,
            achievementRewards: 0,
            lotteryEntries: 0,
            lotteryWinnings: 0,
            shopPurchases: 0,
            shopSales: 0,
            bankFeesPaid: 0,
            bankDeposits: 0,
            bankWithdrawals: 0
        },
        achievements: {
            unlocked: [],
            claimed: [],
            progress: {},
            unlockedAt: {},
            updatedAt: now
        },
        equippedTitleId: null,
        equippedVariantCode: null
    };
}

function counterpartyTransactionDocument(operationId, guildId, actorUserId, type, amount, properties = {}) {
    const id = `${operationId}:counterparty:${actorUserId}`;
    return {
        _id: id,
        idempotencyKey: id,
        guildId,
        actorUserId,
        type,
        amount,
        currencyIssued: 0,
        currencyRemoved: 0,
        currencyReturned: 0,
        outcome: "completed",
        createdAt: new Date(),
        ...properties
    };
}

function getCollections() {
    const db = getDB();
    return {
        accounts: db.collection("economyAccounts"),
        transactions: db.collection("economyTransactions"),
        operations: db.collection("economyOperations"),
        inventory: db.collection("economyInventory"),
        titles: db.collection("economyTitles"),
        effects: db.collection("economyEffects"),
        stock: db.collection("economyGlobalStock"),
        stockPurchases: db.collection("economyGlobalStockPurchases"),
        rounds: db.collection("economyLotteryRounds"),
        entries: db.collection("economyLotteryEntries"),
        legacyStock: db.collection("economyStock"),
        legacyStockPurchases: db.collection("economyStockPurchases"),
        legacyArchive: db.collection("economyLegacyArchive"),
        migrations: db.collection("economyMigrations"),
        adminConfirmations: db.collection("economyAdminConfirmations"),
        bankDepositConfirmations: db.collection("economyBankDepositConfirmations"),
        adminAudit: db.collection("economyAdminAudit")
    };
}

function mergeLegacyAccount(records, userId, now) {
    const wallet = records.reduce((sum, record) => sum + (record.wallet || 0), 0);
    if (!Number.isSafeInteger(wallet)) {
        throw new Error(`Legacy economy balances for user ${userId} exceed the safe integer limit.`);
    }
    const merged = newAccount(null, userId, records.reduce((earliest, record) =>
        record.createdAt && record.createdAt < earliest ? record.createdAt : earliest, now));
    merged.wallet = wallet;
    merged.stats.totalEarned = 0;
    const numericStats = new Set(Object.keys(merged.stats));
    for (const record of records) {
        for (const [key, value] of Object.entries(record.stats || {})) {
            if (numericStats.has(key) && Number.isSafeInteger(value)) {
                merged.stats[key] += value;
            }
        }
        for (const [key, value] of Object.entries(record.cooldowns || {})) {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime()) &&
                (!merged.cooldowns[key] || date > new Date(merged.cooldowns[key]))) {
                merged.cooldowns[key] = date;
            }
        }
    }
    const equippedRecord = records
        .filter(record => record.equippedTitleId)
        .sort((left, right) => String(left.guildId).localeCompare(String(right.guildId)))[0];
    merged.equippedTitleId = equippedRecord?.equippedTitleId || null;
    merged.equippedVariantCode = equippedRecord?.equippedVariantCode || null;
    merged.migratedFromGuildAccounts = records.length;
    return merged;
}

function normalizeLegacyPeriodId(periodId) {
    if (typeof periodId === "string" && /^\d{8}$/.test(periodId)) {
        return `${periodId.slice(0, 4)}-${periodId.slice(4, 6)}-${periodId.slice(6, 8)}`;
    }
    return periodId;
}

function legacyPeriodEnd(periodId) {
    const normalized = normalizeLegacyPeriodId(periodId);
    const [year, month, day] = normalized.split("-").map(Number);
    const startAt = new Date(Date.UTC(year, month - 1, day) - 345 * 60 * 1000);
    return new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}

async function archiveLegacyDocument(collections, sourceCollection, document, session) {
    const archiveId = `${sourceCollection}:${document._id}`;
    const existing = await collections.legacyArchive.findOne({ _id: archiveId }, { session });
    if (!existing) {
        await collections.legacyArchive.insertOne({
            _id: archiveId,
            sourceCollection,
            sourceDocument: document,
            archivedAt: new Date()
        }, { session });
    }
}

async function migrateLegacyEconomyUser(collections, userId) {
    const session = getClient().startSession();
    try {
        await session.withTransaction(async () => {
            const legacyAccounts = await collections.accounts.find({
                userId,
                guildId: { $exists: true }
            }, { session }).toArray();
            for (const document of legacyAccounts) {
                await archiveLegacyDocument(collections, "economyAccounts", document, session);
            }
            const globalAccount = await collections.accounts.findOne({ _id: userId }, { session });
            const merged = mergeLegacyAccount(legacyAccounts, userId, new Date());
            if (globalAccount) {
                const wallet = globalAccount.wallet + merged.wallet;
                if (!Number.isSafeInteger(wallet)) {
                    throw new Error(`Global economy balance for user ${userId} exceeds the safe integer limit.`);
                }
                for (const [key, value] of Object.entries(merged.stats)) {
                    merged.stats[key] = (globalAccount.stats?.[key] || 0) + value;
                }
                merged.cooldowns = { ...globalAccount.cooldowns, ...merged.cooldowns };
                for (const [key, value] of Object.entries(globalAccount.cooldowns || {})) {
                    const migrated = merged.cooldowns[key];
                    if (!migrated || new Date(value) > new Date(migrated)) merged.cooldowns[key] = value;
                }
                merged.wallet = wallet;
                merged.createdAt = globalAccount.createdAt || merged.createdAt;
                const equipped = globalAccount.equippedTitleId ? globalAccount : merged;
                merged.equippedTitleId = equipped.equippedTitleId || null;
                merged.equippedVariantCode = equipped.equippedVariantCode || null;
                await collections.accounts.replaceOne({ _id: userId }, merged, { session });
            } else {
                await collections.accounts.insertOne(merged, { session });
            }
            await collections.accounts.deleteMany({
                userId,
                guildId: { $exists: true }
            }, { session });

            const oldInventory = await collections.inventory.find({
                userId,
                guildId: { $exists: true }
            }, { session }).toArray();
            const inventoryByItem = new Map();
            for (const record of oldInventory) {
                await archiveLegacyDocument(collections, "economyInventory", record, session);
                const group = inventoryByItem.get(record.itemId) || {
                    quantity: 0,
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt
                };
                group.quantity += record.quantity || 0;
                if (record.createdAt && (!group.createdAt || record.createdAt < group.createdAt)) group.createdAt = record.createdAt;
                if (record.updatedAt && (!group.updatedAt || record.updatedAt > group.updatedAt)) group.updatedAt = record.updatedAt;
                inventoryByItem.set(record.itemId, group);
            }
            for (const [itemId, group] of inventoryByItem) {
                const id = `${userId}:${itemId}`;
                const existing = await collections.inventory.findOne({ _id: id }, { session });
                const quantity = group.quantity + (existing?.quantity || 0);
                await collections.inventory.replaceOne(
                    { _id: id },
                    { _id: id, userId, itemId, quantity, createdAt: existing?.createdAt || group.createdAt, updatedAt: new Date() },
                    { upsert: true, session }
                );
            }
            await collections.inventory.deleteMany({ userId, guildId: { $exists: true } }, { session });

            const oldTitles = await collections.titles.find({
                userId,
                guildId: { $exists: true }
            }, { session }).toArray();
            for (const record of oldTitles) {
                await archiveLegacyDocument(collections, "economyTitles", record, session);
                const id = record.variantCode
                    ? `variant:${record.variantCode}`
                    : `${userId}:${record.titleId}`;
                const filter = record.variantCode
                    ? { _id: id }
                    : { _id: id };
                const existing = await collections.titles.findOne(filter, { session });
                if (!existing) {
                    const migrated = {
                        ...record,
                        _id: id,
                        userId,
                        sourceGuildId: record.guildId
                    };
                    delete migrated.guildId;
                    await collections.titles.insertOne(migrated, { session });
                } else if (!record.variantCode &&
                    record.purchasedAt && record.purchasedAt < existing.purchasedAt) {
                    await collections.titles.updateOne(
                        { _id: id },
                        { $set: { purchasedAt: record.purchasedAt } },
                        { session }
                    );
                }
            }
            await collections.titles.deleteMany({ userId, guildId: { $exists: true } }, { session });

            const oldEffects = await collections.effects.find({
                userId,
                guildId: { $exists: true }
            }, { session }).toArray();
            const now = new Date();
            const luckEffects = new Map();
            for (const effect of oldEffects) {
                await archiveLegacyDocument(collections, "economyEffects", effect, session);
                if (new Date(effect.expiresAt) <= now) continue;
                if (effect.effectType.startsWith("coinflip-luck")) {
                    const remaining = new Date(effect.expiresAt).getTime() - now.getTime();
                    luckEffects.set(effect.effectType, (luckEffects.get(effect.effectType) || 0) + remaining);
                } else {
                    const id = `${userId}:${effect.effectType}:${effect.effectId || effect._id}`;
                    const migrated = { ...effect, _id: id, userId };
                    delete migrated.guildId;
                    await collections.effects.replaceOne({ _id: id }, migrated, { upsert: true, session });
                }
            }
            for (const [effectType, duration] of luckEffects) {
                const id = `${userId}:${effectType}`;
                const migrated = {
                    _id: id,
                    userId,
                    effectId: effectType,
                    effectType,
                    activatedAt: now,
                    expiresAt: new Date(now.getTime() + duration),
                    sourceItemId: effectType
                };
                await collections.effects.replaceOne({ _id: id }, migrated, { upsert: true, session });
            }
            await collections.effects.deleteMany({ userId, guildId: { $exists: true } }, { session });
        });
    } finally {
        await session.endSession();
    }
}

async function migrateLegacyEconomyData(collections = getCollections()) {
    const marker = await collections.migrations.findOne({ _id: "global-economy-userid-v1" });
    if (marker) return marker;
    const legacyPlayerRows = await Promise.all([
        collections.accounts.find({ guildId: { $exists: true } }, { projection: { userId: 1 } }).toArray(),
        collections.inventory.find({ guildId: { $exists: true } }, { projection: { userId: 1 } }).toArray(),
        collections.titles.find({ guildId: { $exists: true } }, { projection: { userId: 1 } }).toArray(),
        collections.effects.find({ guildId: { $exists: true } }, { projection: { userId: 1 } }).toArray()
    ]);
    const userIds = [...new Set(legacyPlayerRows.flat()
        .map(record => record.userId)
        .filter(Boolean))];
    for (const userId of userIds) await migrateLegacyEconomyUser(collections, userId);
    await migrateLegacyLimitedStock(collections);
    const migration = {
        _id: "global-economy-userid-v1",
        completedAt: new Date(),
        migratedUsers: userIds.length,
        walletStrategy: "sum all per-guild wallet balances to preserve recorded coins",
        cooldownStrategy: "retain the latest timestamp per action",
        inventoryStrategy: "sum quantities per user and stable item ID",
        titleStrategy: "union title types; preserve every unique Variant code",
        effectStrategy: "sum remaining Luck durations by tier; preserve active guards individually",
        limitedStockStrategy: "carry current-period purchases into one global stock; prior-period records remain archived",
        sourceCollectionsArchived: [
            "economyAccounts", "economyInventory", "economyTitles", "economyEffects",
            "economyStock", "economyStockPurchases"
        ]
    };
    try {
        await collections.migrations.insertOne(migration);
    } catch (error) {
        if (error.code !== 11000) throw error;
    }

    async function migrateLegacyLimitedStock(collections) {
        const [legacyStock, legacyPurchases] = await Promise.all([
            collections.legacyStock.find({ guildId: { $exists: true } }).toArray(),
            collections.legacyStockPurchases.find({ guildId: { $exists: true } }).toArray()
        ]);
        if (!legacyStock.length && !legacyPurchases.length) return;
        const currentPeriod = getWeeklyPeriod();
        const soldByItemPeriod = new Map();
        for (const stock of legacyStock) {
            await archiveLegacyDocument(collections, "economyStock", stock);
            const periodId = normalizeLegacyPeriodId(stock.periodId);
            const key = `${stock.itemId}:${periodId}`;
            soldByItemPeriod.set(key, (soldByItemPeriod.get(key) || 0) + (stock.sold || 0));
        }
        for (const purchase of legacyPurchases) {
            await archiveLegacyDocument(collections, "economyStockPurchases", purchase);
            const item = getCatalogItem(purchase.itemId);
            if (!item?.weeklyStock) continue;
            const periodId = normalizeLegacyPeriodId(purchase.periodId);
            const purchaseKey = item.permitsDuplicates
                ? `legacy:${purchase._id}`
                : "once";
            const id = `${purchase.userId}:${item.id}:${periodId}:${purchaseKey}`;
            const existing = await collections.stockPurchases.findOne({ _id: id });
            if (!existing) {
                await collections.stockPurchases.insertOne({
                    _id: id,
                    userId: purchase.userId,
                    itemId: item.id,
                    periodId,
                    purchaseKey,
                    purchasedAt: purchase.purchasedAt || new Date(),
                    expiresAt: legacyPeriodEnd(periodId)
                });
            }
        }
        const items = new Set([
            ...legacyStock.filter(record =>
                normalizeLegacyPeriodId(record.periodId) === currentPeriod.periodId
            ).map(record => record.itemId),
            ...legacyPurchases.filter(record =>
                normalizeLegacyPeriodId(record.periodId) === currentPeriod.periodId
            ).map(record => record.itemId)
        ]);
        for (const itemId of items) {
            const item = getCatalogItem(itemId);
            if (!item?.weeklyStock) continue;
            const id = `${itemId}:${currentPeriod.periodId}`;
            const sold = Math.max(
                soldByItemPeriod.get(`${itemId}:${currentPeriod.periodId}`) || 0,
                legacyPurchases.filter(record =>
                    record.itemId === itemId &&
                    normalizeLegacyPeriodId(record.periodId) === currentPeriod.periodId
                ).length
            );
            const existing = await collections.stock.findOne({ _id: id });
            const totalSold = Math.max(sold, existing?.sold || 0);
            await collections.stock.replaceOne({
                _id: id
            }, {
                _id: id,
                itemId,
                periodId: currentPeriod.periodId,
                available: Math.max(0, item.weeklyStock - totalSold),
                sold: totalSold,
                restockedAt: currentPeriod.startAt,
                expiresAt: currentPeriod.endAt
            }, { upsert: true });
        }
    }
    console.log(`✅ Migrated ${userIds.length} player account(s) to the global economy identity`);
    return migration;
}

async function migrateAvengerTag(collections) {
    const oldOwnership = await collections.titles.find({
        titleId: { $in: ["avenger", "Avenger"] }
    }).toArray();
    let renamed = 0;
    let archivedDuplicates = 0;
    for (const ownership of oldOwnership) {
        const duplicate = await collections.titles.findOne({
            userId: ownership.userId,
            titleId: "ones-above-all",
            variantCode: ownership.variantCode
        });
        if (duplicate) {
            await collections.migrations.updateOne(
                { _id: `avenger-title-duplicate:${ownership._id}` },
                {
                    $setOnInsert: {
                        migration: "avenger-to-ones-above-all-v1",
                        sourceOwnership: ownership,
                        preservedByOwnershipId: duplicate._id,
                        archivedAt: new Date()
                    }
                },
                { upsert: true }
            );
            await collections.titles.deleteOne({ _id: ownership._id });
            archivedDuplicates++;
            continue;
        }
        await collections.titles.updateOne(
            { _id: ownership._id },
            { $set: { titleId: "ones-above-all" } }
        );
        renamed++;
    }
    const accountsWithLegacyTitle = await collections.accounts.find({
        equippedTitleId: { $in: ["avenger", "Avenger"] }
    }).toArray();
    for (const account of accountsWithLegacyTitle) {
        await collections.accounts.updateOne(
            { _id: account._id },
            { $set: { equippedTitleId: "ones-above-all" } }
        );
    }
    await collections.migrations.updateOne(
        { _id: "avenger-to-ones-above-all-v1" },
        {
            $set: {
                migration: "avenger-to-ones-above-all-v1",
                renamed,
                archivedDuplicates,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );
    if (renamed || archivedDuplicates) {
        console.log(`✅ Migrated ${renamed} Avenger title ownership record(s) to Ones Above All; archived ${archivedDuplicates} duplicate(s)`);
    }
}

async function initializeEconomyStorage() {
    const collections = getCollections();
    await migrateLegacyEconomyData(collections);
    await migrateAvengerTag(collections);
    const titleIndexes = await collections.titles.listIndexes().toArray();
    const obsoleteTitleIndex = titleIndexes.find(index =>
        JSON.stringify(index.key) === JSON.stringify({ userId: 1, titleId: 1 }) &&
        index.partialFilterExpression?.variantCode?.$exists === false
    );
    if (obsoleteTitleIndex) {
        await collections.titles.dropIndex(obsoleteTitleIndex.name);
    }
    await Promise.all([
        collections.accounts.createIndex({ userId: 1 }, { unique: true }),
        collections.accounts.createIndex({ wallet: -1, userId: 1 }),
        collections.transactions.createIndex({ actorUserId: 1, createdAt: -1 }),
        collections.transactions.createIndex({ counterpartyUserId: 1, createdAt: -1 }),
        collections.transactions.createIndex({ idempotencyKey: 1 }, { unique: true }),
        collections.inventory.createIndex({ userId: 1, itemId: 1 }, { unique: true }),
        collections.titles.createIndex(
            { userId: 1, titleId: 1, variantCode: 1 },
            { unique: true, name: "userId_1_titleId_1_variantCode_1" }
        ),
        collections.titles.createIndex({ variantCode: 1 }, { unique: true, sparse: true }),
        collections.titles.createIndex({ userId: 1, purchasedAt: 1 }),
        collections.effects.createIndex({ userId: 1, effectType: 1, expiresAt: 1 }),
        collections.stock.createIndex({ itemId: 1, periodId: 1 }, { unique: true }),
        collections.stockPurchases.createIndex(
            { userId: 1, itemId: 1, periodId: 1, purchaseKey: 1 },
            { unique: true }
        ),
        collections.stockPurchases.createIndex({ userId: 1, itemId: 1, periodId: 1 }),
        collections.rounds.createIndex({ guildId: 1, roundId: 1 }, { unique: true }),
        collections.rounds.createIndex({ state: 1, endAt: 1 }),
        collections.entries.createIndex({ guildId: 1, roundId: 1, userId: 1 }, { unique: true }),
        collections.adminConfirmations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collections.bankDepositConfirmations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collections.adminAudit.createIndex({ createdAt: -1 })
    ]);
    console.log("✅ Global economy MongoDB indexes initialized");
}

async function ensureAccount(guildId, userId, now = new Date()) {
    if (typeof userId !== "string" || !userId) {
        throw new TypeError("A Discord user ID is required to create an economy account.");
    }
    const collections = getCollections();
    const session = getClient().startSession();
    try {
        await session.withTransaction(async () => {
            const existing = await collections.accounts.findOne({ _id: userId }, { session, projection: { _id: 1 } });
            if (existing) return;
            const account = newAccount(null, userId, now);
            await collections.accounts.insertOne(account, { session });
            await collections.transactions.insertOne({
                _id: `initial:${account._id}`,
                idempotencyKey: `initial:${account._id}`,
                actorUserId: userId,
                type: "starting_balance",
                amount: config.startingBalance,
                currencyIssued: config.startingBalance,
                currencyRemoved: 0,
                currencyReturned: 0,
                outcome: "granted",
                balanceBefore: 0,
                balanceAfter: config.startingBalance,
                createdAt: now,
                metadata: { description: "One-time starting balance" }
            }, { session });
        });
    } catch (error) {
        if (error.code !== 11000) throw error;
        const account = await collections.accounts.findOne({ _id: userId });
        if (account) return account;
        throw error;
    } finally {
        await session.endSession();
    }
    return collections.accounts.findOne({ _id: userId });
}

async function getPreviousOperation(collections, userId, operationId, operationName, session) {
    const previous = await collections.operations.findOne({ _id: operationId }, { session });
    if (!previous) return null;
    if (previous.userId !== userId || previous.operation !== operationName) {
        throw new Error("An operation ID was reused for a different economy action.");
    }
    return previous;
}

function getAchievementMetric(id, account, ownedTitleIds, now = new Date()) {
    const stats = account.stats || {};
    const bank = account.bank || {};
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(account.createdAt || now).getTime()) / 86400000));
    const rarityRank = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5, Mythic: 6 };
    const rareTitleCount = [...ownedTitleIds].filter(titleId => {
        const item = getCatalogItem(titleId);
        return item && (rarityRank[item.rarity] || 0) >= rarityRank.Rare;
    }).length;
    const combinedWealth = Number(account.wallet || 0) + Number(bank.balance || 0);
    const metrics = {
        "first-fortune": [account.wallet || 0, 10000],
        "coin-flip-winner": [stats.coinflipWins || 0, 10],
        "unlucky-flipper": [stats.coinflipLosses || 0, 5],
        "robbery-victim": [stats.robberyVictimCount || 0, 5],
        "pocket-change": [stats.totalEarned || 0, 10000],
        "making-progress": [stats.totalEarned || 0, 100000],
        "self-made": [stats.totalEarned || 0, 1000000],
        millionaire: [account.wallet || 0, 1000000],
        billionaire: [account.wallet || 0, 1000000000],
        workaholic: [stats.workActions || 0, 100],
        "dedicated-worker": [stats.workActions || 0, 500],
        "daily-discipline": [stats.dailyClaims || 0, 30],
        "weekly-regular": [stats.weeklyClaims || 0, 12],
        "generous-soul": [stats.coinsGiven || 0, 50000],
        benefactor: [stats.coinsGiven || 0, 500000],
        "community-supporter": [stats.transfersGiven || 0, 100],
        "risk-taker": [stats.coinflipBets || 0, 50],
        "high-roller": [stats.highRollerWins || 0, 1],
        "double-down": [stats.coinflipWins || 0, 25],
        "house-favourite": [stats.coinflipWins || 0, 100],
        "lucky-seven": [stats.lotteryWins || 0, 7],
        "lottery-legend": [stats.lotteryWins || 0, 50],
        "big-jackpot": [stats.biggestLotteryPayout || 0, 100000],
        comeback: [stats.comebackWins || 0, 1],
        "career-criminal": [stats.successfulSteals || 0, 10],
        "master-thief": [stats.successfulSteals || 0, 50],
        untouchable: [stats.protectedAvoidances || 0, 10],
        collector: [ownedTitleIds.size, 5],
        "elite-collector": [ownedTitleIds.size, 10],
        "rare-find": [rareTitleCount, 3],
        "ultimate-collector": [ownedTitleIds.size, 20],
        banker: [bank.balance || 0, 100000],
        "financially-secure": [combinedWealth, 1000000],
        "long-term-saver": [stats.longTermSavedWithdrawals || 0, 1],
        "fee-free-threshold": [stats.feeFreeWithdrawals || 0, 1],
        "consistent-saver": [stats.bankDeposits || 0, 25],
        veteran: [ageDays, 30],
        "seasoned-veteran": [ageDays, 90],
        "legendary-veteran": [ageDays, 365],
        "prize-winner": [stats.biggestLotteryPayout || 0, 5000],
        "global-collector": [ownedTitleIds.size, 15]
    };
    const metric = metrics[id];
    if (!metric) throw new Error(`Achievement ${id} has no progress tracker.`);
    return { current: Number(metric[0] || 0), target: metric[1] };
}

async function updateAchievementsForUser(collections, userId, session, now = new Date()) {
    const account = await collections.accounts.findOne({ _id: userId }, { session });
    if (!account) return;
    const { getAchievementCatalog } = require("./economy-achievements");
    const achievementCatalog = getAchievementCatalog();
    const ownedTitles = await collections.titles.find({ userId }, { session, projection: { titleId: 1 } }).toArray();
    const ownedTitleIds = new Set(ownedTitles.map(title => title.titleId).filter(titleId =>
        titles.some(item => item.id === titleId)
    ));
    const state = {
        ...(account.achievements || {}),
        unlocked: [...(account.achievements?.unlocked || [])],
        claimed: [...(account.achievements?.claimed || [])],
        unlockedAt: { ...(account.achievements?.unlockedAt || {}) },
        progress: {}
    };
    let wallet = Number(account.wallet || 0);

    for (const achievement of achievementCatalog) {
        const metric = getAchievementMetric(achievement.id, account, ownedTitleIds, now);
        state.progress[achievement.id] = {
            current: metric.current,
            target: metric.target,
            percentage: Math.min(100, Math.floor((metric.current / metric.target) * 100))
        };
        if (state.unlocked.includes(achievement.id) || metric.current < metric.target) continue;

        const rewardCoins = Number(achievement.rewardCoins || 0);
        assertSafeCredit(wallet, rewardCoins);
        const nextWallet = wallet + rewardCoins;
        if (rewardCoins > 0) {
            assertUpdated(await collections.accounts.updateOne(
                { _id: userId, wallet: { $lte: Number.MAX_SAFE_INTEGER - rewardCoins } },
                { $inc: { wallet: rewardCoins, "stats.achievementRewards": rewardCoins } },
                { session }
            ), "Your achievement reward could not be credited safely.");
        }
        for (const rewardName of achievement.rewardTags || []) {
            const item = getCatalogItem(rewardName);
            if (!item?.exclusive) {
                throw new Error(`Achievement ${achievement.id} references a non-exclusive reward tag.`);
            }
            const alreadyOwned = await collections.titles.findOne({
                userId,
                titleId: item.id
            }, { session });
            if (!alreadyOwned) {
                await collections.titles.insertOne({
                    _id: `${userId}:${item.id}`,
                    userId,
                    titleId: item.id,
                    purchasedAt: now,
                    source: "achievement",
                    achievementId: achievement.id
                }, { session });
            }
        }
        state.unlocked.push(achievement.id);
        state.claimed.push(achievement.id);
        state.unlockedAt[achievement.id] = now;
        wallet = nextWallet;
        await collections.transactions.insertOne(transactionDocument(
            `achievement:${userId}:${achievement.id}`,
            null,
            userId,
            "achievement_reward",
            rewardCoins,
            {
                currencyIssued: rewardCoins,
                balanceBefore: wallet - rewardCoins,
                balanceAfter: wallet,
                createdAt: now,
                metadata: {
                    achievementId: achievement.id,
                    rewardCoins,
                    rewardTags: achievement.rewardTags || []
                }
            }
        ), { session });
    }

    const allUnlocked = achievementCatalog.every(achievement => state.unlocked.includes(achievement.id));
    if (allUnlocked && !state.completionTagGrantedAt) {
        const darkKnight = getCatalogItem("the-dark-knight");
        const existing = await collections.titles.findOne({ userId, titleId: darkKnight.id }, { session });
        if (!existing) {
            await collections.titles.insertOne({
                _id: `${userId}:${darkKnight.id}`,
                userId,
                titleId: darkKnight.id,
                purchasedAt: now,
                source: "achievement_completion"
            }, { session });
        }
        state.completionTagGrantedAt = now;
    }
    state.updatedAt = now;
    await collections.accounts.updateOne(
        { _id: userId },
        { $set: { achievements: state } },
        { session }
    );
}

async function withOperation(guildId, userId, operationId, operationName, action) {
    if (typeof operationId !== "string" || !operationId) {
        throw new TypeError("A unique operation ID is required.");
    }
    const collections = getCollections();
    const session = getClient().startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            const previous = await getPreviousOperation(
                collections, userId, operationId, operationName, session
            );
            if (previous) {
                result = previous.result;
                return;
            }
            result = await action(session);
            if (!operationName.startsWith("admin_")) {
                await updateAchievementsForUser(collections, userId, session);
            }
            await collections.operations.insertOne({
                _id: operationId,
                userId,
                operation: operationName,
                result,
                createdAt: new Date()
            }, { session });
        });
        return result;
    } catch (error) {
        if (error.code !== 11000) throw error;
        const previous = await collections.operations.findOne({ _id: operationId });
        if (previous && previous.userId === userId && previous.operation === operationName) {
            return previous.result;
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

function transactionDocument(operationId, guildId, actorUserId, type, amount, properties = {}) {
    return {
        _id: operationId,
        idempotencyKey: operationId,
        guildId,
        actorUserId,
        type,
        amount,
        currencyIssued: 0,
        currencyRemoved: 0,
        currencyReturned: 0,
        outcome: "completed",
        createdAt: new Date(),
        ...properties
    };
}

function assertUpdated(result, message) {
    if (result.matchedCount !== 1) throw new UserFacingError(message);
}

function assertSafeCredit(balance, amount) {
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(amount) ||
        amount < 0 || balance > Number.MAX_SAFE_INTEGER - amount) {
        throw new UserFacingError("That currency change would exceed the safe wallet limit.");
    }
}

async function getAccount(guildId, userId) {
    await ensureAccount(guildId, userId);
    return getCollections().accounts.findOne({ _id: userId });
}

async function getExistingAccount(guildId, userId) {
    return getCollections().accounts.findOne({ _id: userId });
}

function randomInclusive(minimum, maximum, random = randomInt) {
    return minimum + random(maximum - minimum + 1);
}

function cooldownFilter(accountKey, action, cooldownMs, now) {
    const field = `cooldowns.${action}`;
    return {
        _id: accountKey,
        $or: [
            { [field]: { $exists: false } },
            { [field]: { $lte: new Date(now.getTime() - cooldownMs) } }
        ]
    };
}

async function claimReward({ guildId, userId, operationId, kind, random = randomInt }) {
    const rewardConfig = config[kind];
    if (!rewardConfig) throw new TypeError(`Unknown reward type: ${kind}`);
    const now = new Date();
    await ensureAccount(guildId, userId, now);
    const collections = getCollections();
    const previous = await getPreviousOperation(collections, userId, operationId, kind);
    if (previous) return previous.result;
    const accountKey = accountId(userId);
    const currentAccount = await collections.accounts.findOne({ _id: accountKey });
    const previousAt = currentAccount?.cooldowns?.[kind];
    const remaining = previousAt
        ? rewardConfig.cooldownMs - (now.getTime() - new Date(previousAt).getTime())
        : 0;
    if (remaining > 0) {
        throw new UserFacingError(`You can claim /${kind} again in ${Math.ceil(remaining / 60000)} minute(s).`);
    }
    const reward = randomInclusive(rewardConfig.minimum, rewardConfig.maximum, random);
    const job = kind === "work" ? config.work.jobs[random(config.work.jobs.length)] : null;

    return withOperation(guildId, userId, operationId, kind, async session => {
        const current = await collections.accounts.findOne({ _id: accountKey }, { session });
        if (!current) throw new UserFacingError("Your economy account could not be found.");
        const balanceBefore = current.wallet;
        assertSafeCredit(balanceBefore, reward);
        assertUpdated(await collections.accounts.updateOne(
            {
                ...cooldownFilter(accountKey, kind, rewardConfig.cooldownMs, now),
                wallet: { $lte: Number.MAX_SAFE_INTEGER - reward }
            },
            {
                $inc: {
                    wallet: reward,
                    "stats.totalEarned": reward,
                    ...(kind === "work" ? { "stats.workActions": 1 } : {}),
                    ...(kind === "daily" ? { "stats.dailyClaims": 1 } : {}),
                    ...(kind === "weekly" ? { "stats.weeklyClaims": 1 } : {})
                },
                $set: { [`cooldowns.${kind}`]: now }
            },
            { session }
        ), `Your /${kind} cooldown is still active.`);
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, kind, reward, {
                currencyIssued: reward,
                balanceBefore,
                balanceAfter: balanceBefore + reward,
                createdAt: now,
                metadata: { reward }
            }
        ), { session });
        return {
            reward,
            balance: balanceBefore + reward,
            nextAt: new Date(now.getTime() + rewardConfig.cooldownMs),
            ...(kind === "work" ? { job } : {})
        };
    });
}

async function claimWork({ guildId, userId, operationId, random = randomInt }) {
    return claimReward({ guildId, userId, operationId, kind: "work", random });
}

async function claimBeg({ guildId, userId, operationId, random = randomInt }) {
    await ensureAccount(guildId, userId);
    const now = new Date();
    const accountKey = accountId(userId);
    const collections = getCollections();
    const previous = await getPreviousOperation(collections, userId, operationId, "beg");
    if (previous) return previous.result;
    const accountBefore = await collections.accounts.findOne({ _id: accountKey });
    const previousAt = accountBefore?.cooldowns?.beg;
    const remaining = previousAt
        ? config.beg.cooldownMs - (now.getTime() - new Date(previousAt).getTime())
        : 0;
    if (remaining > 0) {
        throw new UserFacingError(`You can beg again in ${Math.ceil(remaining / 60000)} minute(s).`);
    }
    const reward = randomInclusive(config.beg.minimum, config.beg.maximum, random);
    const succeeded = random(100) < config.beg.successPercent;
    const payout = succeeded ? reward : 0;

    return withOperation(guildId, userId, operationId, "beg", async session => {
        const account = await collections.accounts.findOne({ _id: accountKey }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        const balanceBefore = account.wallet;
        assertSafeCredit(balanceBefore, payout);
        assertUpdated(await collections.accounts.updateOne(
            {
                ...cooldownFilter(accountKey, "beg", config.beg.cooldownMs, now),
                wallet: { $lte: Number.MAX_SAFE_INTEGER - payout }
            },
            {
                ...(payout ? { $inc: { wallet: payout, "stats.totalEarned": payout } } : {}),
                $set: { "cooldowns.beg": now }
            },
            { session }
        ), "Your beg cooldown is still active.");
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "beg", payout, {
                currencyIssued: payout,
                outcome: succeeded ? "success" : "failed",
                balanceBefore,
                balanceAfter: balanceBefore + payout,
                createdAt: now,
                metadata: { attemptSucceeded: succeeded }
            }
        ), { session });
        return {
            succeeded,
            reward: payout,
            balance: balanceBefore + payout,
            nextAt: new Date(now.getTime() + config.beg.cooldownMs)
        };
    });
}

async function transfer({ guildId, fromUserId, toUserId, amount, operationId }) {
    if (fromUserId === toUserId) throw new UserFacingError("You cannot transfer coins to yourself.");
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserFacingError("Enter a positive whole-number amount.");
    await Promise.all([ensureAccount(guildId, fromUserId), ensureAccount(guildId, toUserId)]);
    const now = new Date();

    return withOperation(guildId, fromUserId, operationId, "give", async session => {
        const collections = getCollections();
        const sender = await collections.accounts.findOne({ _id: accountId(fromUserId) }, { session });
        const recipient = await collections.accounts.findOne({ _id: accountId(toUserId) }, { session });
        if (!sender || sender.wallet < amount) throw new UserFacingError("You do not have enough coins for that transfer.");
        assertSafeCredit(recipient.wallet, amount);
        assertUpdated(await collections.accounts.updateOne(
            { _id: accountId(fromUserId), wallet: { $gte: amount } },
            {
                $inc: {
                    wallet: -amount,
                    "stats.totalSpent": amount,
                    "stats.totalTransferred": amount,
                    "stats.coinsGiven": amount,
                    "stats.transfersGiven": 1
                }
            },
            { session }
        ), "Your balance changed. Please try again.");
        assertUpdated(await collections.accounts.updateOne(
            { _id: accountId(toUserId), wallet: { $lte: Number.MAX_SAFE_INTEGER - amount } },
            { $inc: { wallet: amount, "stats.totalReceived": amount } },
            { session }
        ), "The recipient account could not be updated.");
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, fromUserId, "transfer", amount, {
                counterpartyUserId: toUserId,
                balanceBefore: sender.wallet,
                balanceAfter: sender.wallet - amount,
                createdAt: now
            }
        ), { session });
        await collections.transactions.insertOne(counterpartyTransactionDocument(
            operationId, guildId, toUserId, "transfer_received", amount, {
                counterpartyUserId: fromUserId,
                balanceBefore: recipient.wallet,
                balanceAfter: recipient.wallet + amount,
                createdAt: now,
                relatedOperationId: operationId
            }
        ), { session });
        await updateAchievementsForUser(collections, toUserId, session, now);
        return { amount, balance: sender.wallet - amount, recipientId: toUserId };
    });
}

async function steal({ guildId, thiefId, targetId, operationId, random = randomInt }) {
    if (thiefId === targetId) throw new UserFacingError("You cannot steal from yourself.");
    await Promise.all([ensureAccount(guildId, thiefId), ensureAccount(guildId, targetId)]);
    const now = new Date();
    const outcomeRoll = random(100);
    const stealPercent = randomInclusive(config.steal.minimumPercent, config.steal.maximumPercent, random);
    const thiefKey = accountId(thiefId);
    const targetKey = accountId(targetId);

    return withOperation(guildId, thiefId, operationId, "steal", async session => {
        const collections = getCollections();
        const thief = await collections.accounts.findOne({ _id: thiefKey }, { session });
        const target = await collections.accounts.findOne({ _id: targetKey }, { session });
        if (thief.wallet < config.steal.minimumWallet) {
            throw new UserFacingError(`You need at least ${config.steal.minimumWallet} coins to attempt a steal.`);
        }
        if (target.wallet < config.steal.minimumTargetWallet) {
            throw new UserFacingError("That member does not have enough wallet funds to target.");
        }
        const previousAt = thief.cooldowns?.steal;
        const remaining = previousAt
            ? config.steal.cooldownMs - (now.getTime() - new Date(previousAt).getTime())
            : 0;
        if (remaining > 0) throw new UserFacingError(`You can steal again in ${Math.ceil(remaining / 60000)} minute(s).`);

        assertUpdated(await collections.accounts.updateOne(
            { _id: targetKey },
            { $inc: { bodyguardVersion: 1 } },
            { session }
        ), "The target account could not be locked for a safe steal check.");
        const guards = await collections.effects.countDocuments({
            userId: targetId,
            effectType: "bodyguard",
            expiresAt: { $gt: now }
        }, { session });
        const successPercent = getStealSuccessPercent(guards);
        const succeeded = outcomeRoll < successPercent;
        let amount;

        if (succeeded) {
            amount = calculateStealAmount(target.wallet, stealPercent);
            assertSafeCredit(thief.wallet, amount);
            assertUpdated(await collections.accounts.updateOne(
                { _id: targetKey, wallet: { $gte: amount } },
                { $inc: { wallet: -amount, "stats.totalSpent": amount, "stats.robberyVictimCount": 1 } },
                { session }
            ), "The target's balance changed before the steal could complete.");
            assertUpdated(await collections.accounts.updateOne(
                { _id: thiefKey, wallet: { $lte: Number.MAX_SAFE_INTEGER - amount } },
                {
                    $inc: {
                        wallet: amount,
                        "stats.totalStolen": amount,
                        "stats.successfulSteals": 1
                    },
                    $set: { "cooldowns.steal": now }
                },
                { session }
            ), "Your wallet cannot safely receive those coins.");
        } else {
            amount = calculateStealFine(thief.wallet);
            assertUpdated(await collections.accounts.updateOne(
                { _id: thiefKey, wallet: { $gte: amount } },
                {
                    $inc: {
                        wallet: -amount,
                        "stats.totalSpent": amount,
                        "stats.failedSteals": 1,
                        "stats.stealFinesPaid": amount
                    },
                    $set: { "cooldowns.steal": now }
                },
                { session }
            ), "Your balance changed before the fine could be resolved.");
            if (amount > 0) {
                assertSafeCredit(target.wallet, amount);
                assertUpdated(await collections.accounts.updateOne(
                    { _id: targetKey, wallet: { $lte: Number.MAX_SAFE_INTEGER - amount } },
                    { $inc: { wallet: amount, "stats.totalReceived": amount, "stats.stealFinesReceived": amount } },
                    { session }
                ), "The victim wallet cannot safely receive the fine.");
            }
        }
        if (!succeeded && guards > 0) {
            assertUpdated(await collections.accounts.updateOne(
                { _id: targetKey },
                { $inc: { "stats.protectedAvoidances": 1 } },
                { session }
            ), "The protected account could not be updated.");
        }

        const thiefAfter = succeeded ? thief.wallet + amount : thief.wallet - amount;
        const targetAfter = succeeded ? target.wallet - amount : target.wallet + amount;
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, thiefId, succeeded ? "steal" : "steal_fine", amount, {
                counterpartyUserId: targetId,
                outcome: succeeded ? "success" : "failed",
                balanceBefore: thief.wallet,
                balanceAfter: thiefAfter,
                createdAt: now,
                metadata: succeeded
                    ? { successPercent, stealPercent }
                    : { successPercent, finePercent: config.steal.finePercent }
            }
        ), { session });
        await collections.transactions.insertOne(counterpartyTransactionDocument(
            operationId, guildId, targetId,
            succeeded ? "steal_victim" : "steal_fine_received",
            amount, {
                counterpartyUserId: thiefId,
                outcome: succeeded ? "stolen_from" : "fine_received",
                balanceBefore: target.wallet,
                balanceAfter: targetAfter,
                createdAt: now,
                relatedOperationId: operationId,
                metadata: { successPercent, amount }
            }
        ), { session });
        await updateAchievementsForUser(collections, targetId, session, now);
        return {
            succeeded,
            amount,
            successPercent,
            guards,
            thiefBalance: thiefAfter,
            targetId,
            nextAt: new Date(now.getTime() + config.steal.cooldownMs)
        };
    });
}

async function coinflip({ guildId, userId, stake, choice, operationId, random = randomInt }) {
    if (!Number.isSafeInteger(stake) ||
        stake < config.coinflip.minimumStake) {
        throw new UserFacingError(`Your wager must be a positive whole number of at least ${config.coinflip.minimumStake} coin.`);
    }
    if (choice !== "heads" && choice !== "tails") {
        throw new UserFacingError("Choose either Heads or Tails before wagering.");
    }
    await ensureAccount(guildId, userId);
    const now = new Date();
    const roll = random(100);
    const key = accountId(userId);

    return withOperation(guildId, userId, operationId, "coinflip", async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (account.wallet < stake) throw new UserFacingError("You do not have enough coins for that stake.");
        const effects = await collections.effects.find({
            userId,
            effectType: { $in: Object.keys(COINFLIP_CHANCES) },
            expiresAt: { $gt: now }
        }, { session }).toArray();
        const luckItem = effects.some(effect => effect.effectType === "coinflip-luck-ii")
            ? "coinflip-luck-ii"
            : effects.some(effect => effect.effectType === "coinflip-luck-i")
                ? "coinflip-luck-i"
                : null;
        const winPercent = luckItem ? COINFLIP_CHANCES[luckItem] : config.coinflip.baseWinPercent;
        const outcome = resolveCoinflip(
            roll,
            winPercent,
            stake,
            config.coinflip.totalWinMultiplier
        );
        const { won, payout } = outcome;
        if (!Number.isSafeInteger(payout)) throw new UserFacingError("That stake is too large to resolve safely.");
        const resultSide = won ? choice : choice === "heads" ? "tails" : "heads";
        const previousLosses = Number(account.stats?.consecutiveGamblingLosses || 0);
        const comebackWin = won && previousLosses >= 5;
        assertSafeCredit(account.wallet - stake, payout);
        const updated = await collections.accounts.updateOne(
            {
                _id: key,
                $and: [
                    { wallet: { $gte: stake } },
                    { wallet: { $lte: Number.MAX_SAFE_INTEGER - Math.max(0, payout - stake) } }
                ]
            },
            {
                $inc: {
                    wallet: -stake + payout,
                    "stats.totalSpent": stake,
                    "stats.coinflipBets": 1,
                    ...(won
                        ? {
                            "stats.gamblingWins": 1,
                            "stats.coinflipWins": 1,
                            "stats.totalEarned": payout - stake,
                            ...(stake >= 100000 ? { "stats.highRollerWins": 1 } : {}),
                            ...(comebackWin ? { "stats.comebackWins": 1 } : {})
                        }
                        : {
                            "stats.gamblingLosses": 1,
                            "stats.coinflipLosses": 1
                        })
                },
                $set: { "stats.consecutiveGamblingLosses": won ? 0 : previousLosses + 1 }
            },
            { session }
        );
        assertUpdated(updated, "Your balance changed before the coinflip could resolve.");
        const balanceAfter = account.wallet - stake + payout;
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "coinflip", stake, {
                currencyIssued: won ? payout - stake : 0,
                currencyRemoved: won ? 0 : stake,
                outcome: won ? "win" : "loss",
                balanceBefore: account.wallet,
                balanceAfter,
                createdAt: now,
                metadata: { stake, payout, net: payout - stake, choice, result: resultSide, winPercent, luckItem }
            }
        ), { session });
        return {
            won,
            choice,
            result: resultSide,
            stake,
            payout,
            net: payout - stake,
            balance: balanceAfter,
            winPercent,
            luckItem
        };
    });
}

async function playNumberLottery({ guildId, userId, number, amount, operationId, random = randomInt }) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 10) {
        throw new UserFacingError("Choose a lottery number from 1 to 10.");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new UserFacingError("Your lottery wager must be a positive whole number.");
    }
    await ensureAccount(guildId, userId);
    const now = new Date();
    const key = accountId(userId);
    return withOperation(guildId, userId, operationId, "number_lottery", async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        if (account.wallet < amount) throw new UserFacingError("You do not have enough wallet coins for that wager.");
        const winningNumbers = [];
        while (winningNumbers.length < 3) {
            const drawn = random(1, 11);
            if (!winningNumbers.includes(drawn)) winningNumbers.push(drawn);
        }
        const prizePosition = winningNumbers.indexOf(number);
        const multiplier = prizePosition < 0 ? 0 : [2, 5, 10][prizePosition];
        const payout = multiplier ? amount * multiplier : 0;
        if (!Number.isSafeInteger(payout)) throw new UserFacingError("That wager is too large to resolve safely.");
        const net = payout - amount;
        const balanceAfter = account.wallet - amount + payout;
        const previousLosses = Number(account.stats?.consecutiveGamblingLosses || 0);
        const comebackWin = payout > 0 && previousLosses >= 5;
        assertSafeCredit(account.wallet - amount, payout);
        assertUpdated(await collections.accounts.updateOne(
            {
                _id: key,
                wallet: { $gte: amount, $lte: Number.MAX_SAFE_INTEGER - Math.max(0, net) }
            },
            {
                $inc: {
                    wallet: net,
                    "stats.totalSpent": amount,
                    "stats.lotteryBets": 1,
                    ...(payout
                        ? {
                            "stats.gamblingWins": 1,
                            "stats.lotteryWins": 1,
                            "stats.lotteryWinnings": payout,
                            "stats.totalEarned": net,
                            ...(comebackWin ? { "stats.comebackWins": 1 } : {})
                        }
                        : {
                            "stats.gamblingLosses": 1
                        })
                },
                $set: {
                    "stats.consecutiveGamblingLosses": payout > 0 ? 0 : previousLosses + 1,
                    ...(payout > 0
                        ? { "stats.biggestLotteryPayout": Math.max(Number(account.stats?.biggestLotteryPayout || 0), payout) }
                        : {})
                }
            },
            { session }
        ), "Your balance changed before the lottery bet could complete.");
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "number_lottery", amount, {
                currencyIssued: payout ? net : 0,
                currencyRemoved: payout ? 0 : amount,
                outcome: payout ? "win" : "loss",
                balanceBefore: account.wallet,
                balanceAfter,
                createdAt: now,
                metadata: { selectedNumber: number, winningNumbers, multiplier, payout, net, wager: amount }
            }
        ), { session });
        return { number, winningNumbers, multiplier, amount, payout, net, balance: balanceAfter, won: Boolean(payout) };
    });
}

function getWeeklyPeriod(date = new Date()) {
    return getKathmanduPeriod(
        date,
        true,
        config.shop.weeklyRestockTimeZone,
        config.shop.weeklyRestockBoundary
    );
}

function getDailyRound(date = new Date()) {
    const period = getKathmanduPeriod(
        date,
        false,
        config.lottery.scheduleTimeZone,
        config.lottery.scheduleBoundary
    );
    return { roundId: period.periodId, ...period };
}

async function getLimitedStock(_guildId, item, now = new Date(), session) {
    if (!item.weeklyStock) return null;
    const period = getWeeklyPeriod(now);
    const id = `${item.id}:${period.periodId}`;
    const collection = getCollections().stock;
    try {
        await collection.updateOne(
            { _id: id },
            {
                $setOnInsert: {
                    itemId: item.id,
                    periodId: period.periodId,
                    available: item.weeklyStock,
                    sold: 0,
                    restockedAt: period.startAt,
                    expiresAt: period.endAt
                }
            },
            { upsert: true, session }
        );
    } catch (error) {
        if (error.code !== 11000 || session) throw error;
    }
    const stock = await collection.findOne({ _id: id }, { session });
    if (!stock) throw new Error("Limited shop stock could not be initialized.");
    return stock;
}

async function getOwnedTitle(_guildId, userId, itemId, session) {
    return getCollections().titles.findOne({ userId, titleId: itemId }, { session });
}

async function enterLottery({ guildId, userId, operationId }) {
    await ensureAccount(guildId, userId);
    const now = new Date();
    const { roundId } = getDailyRound(now);
    const key = accountId(userId);
    const roundKey = `${guildId}:${roundId}`;
    await getCurrentLottery(guildId, now);

    return withOperation(guildId, userId, operationId, "lottery", async session => {
        const collections = getCollections();
        const round = await collections.rounds.findOne({ _id: roundKey }, { session });
        if (!round) throw new Error("The current lottery round could not be initialized.");
        if (round.state !== "open" || round.endAt <= now) {
            throw new UserFacingError("This lottery round is closed. Please try again in the next round.");
        }
        const entryKey = `${roundKey}:${userId}`;
        if (await collections.entries.findOne({ _id: entryKey }, { session })) {
            return {
                entered: false,
                ticketPrice: round.ticketPrice,
                participants: round.participants,
                prizePool: round.prizePool,
                endAt: round.endAt
            };
        }
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (account.wallet < round.ticketPrice) throw new UserFacingError("You do not have enough coins to buy a lottery ticket.");
        assertUpdated(await collections.accounts.updateOne(
            { _id: key, wallet: { $gte: round.ticketPrice } },
            {
                $inc: { wallet: -round.ticketPrice, "stats.totalSpent": round.ticketPrice, "stats.lotteryEntries": 1 }
            },
            { session }
        ), "Your balance changed before the lottery ticket could be purchased.");
        await collections.entries.insertOne({
            _id: entryKey,
            guildId,
            roundId,
            userId,
            ticketPrice: round.ticketPrice,
            createdAt: now
        }, { session });
        await collections.rounds.updateOne(
            { _id: roundKey, state: "open" },
            { $inc: { prizePool: round.ticketPrice, participants: 1 } },
            { session }
        );
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "lottery_entry", round.ticketPrice, {
                currencyRemoved: round.ticketPrice,
                balanceBefore: account.wallet,
                balanceAfter: account.wallet - round.ticketPrice,
                createdAt: now,
                metadata: { roundId }
            }
        ), { session });
        return {
            entered: true,
            ticketPrice: round.ticketPrice,
            participants: round.participants + 1,
            prizePool: round.prizePool + round.ticketPrice,
            endAt: round.endAt
        };
    });
}

async function finalizeLotteryRound(round) {
    const operationId = `lottery-payout:${round._id}`;
    const collections = getCollections();
    let winner = null;
    if (round.endAt <= new Date()) {
        const entryCount = await collections.entries.countDocuments({
            guildId: round.guildId,
            roundId: round.roundId
        });
        if (entryCount) {
            [winner] = await collections.entries.find({
                guildId: round.guildId,
                roundId: round.roundId
            }).sort({ userId: 1 }).skip(randomInt(entryCount)).limit(1).toArray();
        }
    }
    const session = getClient().startSession();
    try {
        await session.withTransaction(async () => {
            const current = await collections.rounds.findOne(
                { _id: round._id, state: "open", endAt: { $lte: new Date() } },
                { session }
            );
            if (!current) return;
            if (!winner) {
                await collections.rounds.updateOne(
                    { _id: current._id, state: "open" },
                    { $set: { state: "complete", winnerUserId: null, finalizedAt: new Date(), payoutStatus: "no_entries" } },
                    { session }
                );
                return;
            }
            const winnerAccount = await collections.accounts.findOne(
                { _id: winner.userId },
                { session }
            );
            assertSafeCredit(winnerAccount.wallet, current.prizePool);
            await collections.accounts.updateOne(
                { _id: winnerAccount._id, wallet: { $lte: Number.MAX_SAFE_INTEGER - current.prizePool } },
                {
                    $inc: { wallet: current.prizePool, "stats.lotteryWinnings": current.prizePool },
                    $set: {
                        "stats.biggestLotteryPayout": Math.max(
                            Number(winnerAccount.stats?.biggestLotteryPayout || 0),
                            current.prizePool
                        )
                    }
                },
                { session }
            );
            await collections.transactions.insertOne(transactionDocument(
                operationId,
                current.guildId,
                winner.userId,
                "lottery_payout",
                current.prizePool,
                {
                    balanceBefore: winnerAccount.wallet,
                    balanceAfter: winnerAccount.wallet + current.prizePool,
                    currencyReturned: current.prizePool,
                    createdAt: new Date(),
                    metadata: { roundId: current.roundId, participants: current.participants }
                }
            ), { session });
            await updateAchievementsForUser(collections, winner.userId, session);
            await collections.rounds.updateOne(
                { _id: current._id, state: "open" },
                {
                    $set: {
                        state: "complete",
                        winnerUserId: winner.userId,
                        finalizedAt: new Date(),
                        payoutStatus: "paid"
                    }
                },
                { session }
            );
        });
    } finally {
        await session.endSession();
    }
}

async function finalizeExpiredLotteryRounds(now = new Date()) {
    const rounds = await getCollections().rounds.find({
        state: "open",
        endAt: { $lte: now }
    }).sort({ endAt: 1 }).limit(100).toArray();
    for (const round of rounds) await finalizeLotteryRound(round);
    return rounds.length;
}

async function startEconomyScheduler() {
    await finalizeExpiredLotteryRounds();
    const timer = setInterval(() => {
        finalizeExpiredLotteryRounds().catch(error => {
            console.error("Economy lottery finalization failed:", { code: error.code || error.name });
        });
    }, 60 * 1000);
    timer.unref();
    return timer;
}

function createVariantCode(randomIndex = maximum => randomInt(maximum)) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let index = 0; index < 5; index += 1) code += alphabet[randomIndex(alphabet.length)];
    return code;
}

async function buyItem({ guildId, userId, itemInput, quantity = 1, operationId }) {
    const item = getCatalogItem(itemInput);
    if (!item) throw new UserFacingError("That shop item does not exist.");
    if (item.exclusive || item.purchaseable === false || !Number.isSafeInteger(item.price)) {
        throw new UserFacingError("That exclusive item cannot be purchased from the shop.");
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
        throw new UserFacingError("Quantity must be a whole number from 1 to 100.");
    }
    if (item.category === "title" && quantity !== 1) {
        throw new UserFacingError("Titles can only be purchased one at a time.");
    }
    const total = item.price * quantity;
    if (!Number.isSafeInteger(total)) throw new UserFacingError("That purchase total is too large.");
    await ensureAccount(guildId, userId);
    const now = new Date();
    const period = item.weeklyStock ? getWeeklyPeriod(now) : null;
    const variantCode = item.id === "variant" ? createVariantCode() : null;
    if (item.weeklyStock) await getLimitedStock(guildId, item, now);

    return withOperation(guildId, userId, operationId, "shop_buy", async session => {
        const collections = getCollections();
        const key = accountId(userId);
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        if (account.wallet < total) throw new UserFacingError("You do not have enough coins for that purchase.");

        if (item.category === "title" && !item.permitsDuplicates &&
            await getOwnedTitle(guildId, userId, item.id, session)) {
            throw new UserFacingError("You already own that title.");
        }
        if (period) {
            const stock = await collections.stock.findOne(
                { _id: `${item.id}:${period.periodId}` },
                { session }
            );
            if (!stock) throw new Error("Limited shop stock record is missing inside the purchase transaction.");
            if (stock.available < quantity) throw new UserFacingError("That limited item is out of stock this week.");
            if (!item.permitsDuplicates) {
                const prior = await collections.stockPurchases.findOne(
                    { userId, itemId: item.id, periodId: period.periodId },
                    { session }
                );
                if (prior) throw new UserFacingError("You already purchased this limited item this week.");
            }
            assertUpdated(await collections.stock.updateOne(
                { _id: stock._id, available: { $gte: quantity } },
                { $inc: { available: -quantity, sold: quantity } },
                { session }
            ), "That limited item just sold out.");
            await collections.stockPurchases.insertOne({
                _id: `${userId}:${item.id}:${period.periodId}:${item.permitsDuplicates ? operationId : "once"}`,
                userId,
                itemId: item.id,
                periodId: period.periodId,
                purchaseKey: item.permitsDuplicates ? operationId : "once",
                purchasedAt: now,
                expiresAt: period.endAt
            }, { session });
        }

        assertUpdated(await collections.accounts.updateOne(
            { _id: key, wallet: { $gte: total } },
            {
                $inc: { wallet: -total, "stats.totalSpent": total, "stats.shopPurchases": 1 }
            },
            { session }
        ), "Your balance changed before the purchase could complete.");

        if (item.category === "title") {
            if (item.id === "variant") {
                if (await collections.titles.findOne({ variantCode }, { session })) {
                    throw new UserFacingError("A unique Variant code could not be generated; please try again.");
                }
                await collections.titles.insertOne({
                    _id: variantCode,
                    userId,
                    titleId: item.id,
                    variantCode,
                    purchasedAt: now,
                    source: "shop"
                }, { session });
            } else {
                await collections.titles.insertOne({
                    _id: `${userId}:${item.id}`,
                    userId,
                    titleId: item.id,
                    purchasedAt: now,
                    source: "shop"
                }, { session });
            }
        } else {
            await collections.inventory.updateOne(
                { _id: `${userId}:${item.id}` },
                {
                    $setOnInsert: { userId, itemId: item.id, createdAt: now },
                    $inc: { quantity },
                    $set: { updatedAt: now }
                },
                { upsert: true, session }
            );
        }
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "shop_purchase", total, {
                currencyRemoved: total,
                balanceBefore: account.wallet,
                balanceAfter: account.wallet - total,
                createdAt: now,
                relatedItemId: item.id,
                metadata: { quantity, variantCode, periodId: period?.periodId || null }
            }
        ), { session });
        return { item, quantity, total, balance: account.wallet - total, variantCode };
    });
}

async function sellItem({ guildId, userId, itemInput, quantity = 1, operationId }) {
    const item = getCatalogItem(itemInput);
    if (!item) throw new UserFacingError("That shop item does not exist.");
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
        throw new UserFacingError("Quantity must be a whole number from 1 to 100.");
    }
    if (!item.sellable || !item.resalePrice) {
        throw new UserFacingError("That item cannot be sold or refunded.");
    }
    if (item.category === "title" && quantity !== 1) {
        throw new UserFacingError("Titles can only be sold one at a time.");
    }
    const payout = item.resalePrice * quantity;
    await ensureAccount(guildId, userId);
    const now = new Date();
    const key = accountId(userId);

    return withOperation(guildId, userId, operationId, "shop_sell", async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        assertSafeCredit(account.wallet, payout);
        if (item.category === "title") {
            const owned = await collections.titles.findOne(
                { userId, titleId: item.id },
                { session }
            );
            if (!owned) throw new UserFacingError("You do not own that title.");
            await collections.titles.deleteOne({ _id: owned._id }, { session });
            if (account.equippedTitleId === item.id &&
                (!owned.variantCode || account.equippedVariantCode === owned.variantCode)) {
                await collections.accounts.updateOne(
                    { _id: key },
                    { $set: { equippedTitleId: null, equippedVariantCode: null } },
                    { session }
                );
            }
        } else {
            const inventoryKey = `${userId}:${item.id}`;
            assertUpdated(await collections.inventory.updateOne(
                { _id: inventoryKey, quantity: { $gte: quantity } },
                { $inc: { quantity: -quantity }, $set: { updatedAt: now } },
                { session }
            ), "You do not have enough unused items to sell.");
            await collections.inventory.deleteOne({ _id: inventoryKey, quantity: { $lte: 0 } }, { session });
        }
        assertUpdated(await collections.accounts.updateOne(
            { _id: key, wallet: { $lte: Number.MAX_SAFE_INTEGER - payout } },
            { $inc: { wallet: payout, "stats.shopSales": 1 } },
            { session }
        ), "Your wallet cannot safely receive the sale proceeds.");
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "shop_sale", payout, {
                currencyReturned: payout,
                balanceBefore: account.wallet,
                balanceAfter: account.wallet + payout,
                createdAt: now,
                relatedItemId: item.id,
                metadata: { quantity }
            }
        ), { session });
        return { item, quantity, payout, balance: account.wallet + payout };
    });
}

async function useItem({ guildId, userId, itemInput, quantity = 1, operationId }) {
    const item = getCatalogItem(itemInput);
    if (!item || item.category !== "consumable") throw new UserFacingError("That is not a usable item.");
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
        throw new UserFacingError("Quantity must be a whole number from 1 to 100.");
    }
    if (item.id === "bodyguard" && quantity !== 1) {
        throw new UserFacingError("Activate one bodyguard at a time.");
    }
    await ensureAccount(guildId, userId);
    const now = new Date();
    const inventoryKey = `${userId}:${item.id}`;

    return withOperation(guildId, userId, operationId, "use_item", async session => {
        const collections = getCollections();
        if (item.id === "bodyguard") {
            assertUpdated(await collections.accounts.updateOne(
                { _id: accountId(userId) },
                { $inc: { bodyguardVersion: 1 } },
                { session }
            ), "Your economy account could not be locked for bodyguard activation.");
        }
        const activeCount = item.id === "bodyguard"
            ? await collections.effects.countDocuments({
                userId, effectType: "bodyguard", expiresAt: { $gt: now }
            }, { session })
            : 0;
        if (item.id === "bodyguard" && activeCount >= config.shop.maximumActiveBodyguards) {
            throw new UserFacingError(`You can have at most ${config.shop.maximumActiveBodyguards} active bodyguards.`);
        }
        const effectType = item.id;
        let expiresAt = new Date(now.getTime() + item.durationMs * quantity);
        const update = await collections.inventory.updateOne(
            { _id: inventoryKey, quantity: { $gte: quantity } },
            { $inc: { quantity: -quantity }, $set: { updatedAt: now } },
            { session }
        );
        assertUpdated(update, "You do not have enough unused items.");
        await collections.inventory.deleteOne({ _id: inventoryKey, quantity: { $lte: 0 } }, { session });

        if (item.id === "bodyguard") {
            await collections.effects.insertOne({
                _id: `${userId}:bodyguard:${operationId}`,
                userId,
                effectId: operationId,
                effectType,
                activatedAt: now,
                expiresAt,
                sourceItemId: item.id
            }, { session });
        } else {
            const effectKey = `${userId}:${effectType}`;
            const existing = await collections.effects.findOne({ _id: effectKey }, { session });
            const startsAt = existing && existing.expiresAt > now ? existing.expiresAt : now;
            const stackedExpiry = new Date(startsAt.getTime() + item.durationMs * quantity);
            expiresAt = stackedExpiry;
            await collections.effects.updateOne(
                { _id: effectKey },
                {
                    $setOnInsert: {
                        userId,
                        effectId: effectType,
                        effectType,
                        activatedAt: now,
                        sourceItemId: item.id
                    },
                    $set: { expiresAt: stackedExpiry, updatedAt: now }
                },
                { upsert: true, session }
            );
        }
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "item_use", 0, {
                createdAt: now,
                relatedItemId: item.id,
                metadata: { quantity, expiresAt }
            }
        ), { session });
        return { item, quantity, expiresAt };
    });
}

async function equipTitle({ guildId, userId, titleInput, operationId }) {
    const normalizedTitle = typeof titleInput === "string" ? titleInput.trim().toUpperCase() : "";
    const item = /^[A-Z0-9]{5}$/.test(normalizedTitle)
        ? getCatalogItem("variant")
        : getCatalogItem(titleInput);
    if (!item || item.category !== "title") throw new UserFacingError("That title does not exist.");
    await ensureAccount(guildId, userId);
    return withOperation(guildId, userId, operationId, "equip_title", async session => {
        const collections = getCollections();
        const owned = item.id === "variant" && /^[A-Z0-9]{5}$/.test(normalizedTitle)
            ? await collections.titles.findOne({
                userId,
                titleId: "variant",
                variantCode: normalizedTitle
            }, { session })
            : await collections.titles.findOne({ userId, titleId: item.id }, { session });
        if (!owned) throw new UserFacingError("You do not own that title.");
        await collections.accounts.updateOne(
            { _id: accountId(userId) },
            { $set: { equippedTitleId: item.id, equippedVariantCode: owned.variantCode || null } },
            { session }
        );
        return { title: item, variantCode: owned.variantCode || null };
    });
}

async function getInventory(guildId, userId, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1001) {
        throw new UserFacingError("Invalid inventory page.");
    }
    const pageSize = 20;
    const skip = (page - 1) * pageSize;
    const collections = getCollections();
    const [ownedTitles, items, effects] = await Promise.all([
        collections.titles.find({ userId }).sort({ purchasedAt: 1 }).skip(skip).limit(pageSize).toArray(),
        collections.inventory.find({ userId, quantity: { $gt: 0 } }).sort({ itemId: 1 }).skip(skip).limit(pageSize).toArray(),
        collections.effects.find({ userId, expiresAt: { $gt: new Date() } }).sort({ expiresAt: 1 }).limit(20).toArray()
    ]);
    const account = await collections.accounts.findOne(
        { _id: userId },
        { projection: { equippedTitleId: 1, equippedVariantCode: 1 } }
    );
    return {
        page,
        equippedTitleId: account?.equippedTitleId || null,
        equippedVariantCode: account?.equippedVariantCode || null,
        titles: ownedTitles.map(owned => ({ ...owned, item: getCatalogItem(owned.titleId) })),
        items: items.map(record => ({ ...record, item: getCatalogItem(record.itemId) })),
        effects: effects.map(effect => ({ ...effect, item: getCatalogItem(effect.sourceItemId) })),
        hasMoreTitles: ownedTitles.length === pageSize,
        hasMoreItems: items.length === pageSize
    };
}

async function getBoosts(guildId, userId, now = new Date()) {
    const effects = await getCollections().effects.find({
        userId,
        expiresAt: { $gt: now }
    }).sort({ expiresAt: 1 }).limit(10).toArray();
    const luckI = effects.find(effect => effect.effectType === "coinflip-luck-i");
    const luckII = effects.find(effect => effect.effectType === "coinflip-luck-ii");
    const guards = effects.filter(effect => effect.effectType === "bodyguard");
    return {
        luckI: luckI?.expiresAt || null,
        luckII: luckII?.expiresAt || null,
        effectiveCoinflipPercent: luckII ? 63 : luckI ? 56 : 50,
        guards: guards.map(guard => guard.expiresAt),
        nextGuardChange: guards[0]?.expiresAt || null
    };
}

async function getCooldowns(guildId, userId, now = new Date()) {
    const account = await getAccount(guildId, userId);
    const cooldowns = {
        daily: config.daily.cooldownMs,
        weekly: config.weekly.cooldownMs,
        work: config.work.cooldownMs,
        beg: config.beg.cooldownMs,
        steal: config.steal.cooldownMs
    };
    return Object.entries(cooldowns).map(([action, duration]) => {
        const lastAt = account.cooldowns?.[action];
        const remainingMs = lastAt
            ? Math.max(0, duration - (now.getTime() - new Date(lastAt).getTime()))
            : 0;
        return { action, remainingMs, readyAt: remainingMs ? new Date(now.getTime() + remainingMs) : null };
    });
}

async function listTransactions(guildId, userId, skip = 0, limit = 10) {
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 10000) throw new UserFacingError("Invalid transaction page.");
    const safeLimit = Math.max(1, Math.min(10, Number.isSafeInteger(limit) ? limit : 10));
    return getCollections().transactions.find({
        actorUserId: userId
    }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(safeLimit).toArray();
}

async function getProfile(guildId, userId) {
    const account = await getAccount(guildId, userId);
    const inventory = await getInventory(guildId, userId);
    const titleTypeRows = await getCollections().titles.aggregate([
        { $match: { userId } },
        { $group: { _id: "$titleId" } }
    ]).toArray();
    const rarityCounts = {};
    for (const titleType of titleTypeRows) {
        const item = getCatalogItem(titleType._id);
        const rarity = item?.rarity || "Unknown";
        rarityCounts[rarity] = (rarityCounts[rarity] || 0) + 1;
    }
    const distinctTitleIds = new Set(titleTypeRows.map(row => row._id));
    return {
        account,
        inventory,
        boosts: await getBoosts(guildId, userId),
        titleCompletion: Math.floor(distinctTitleIds.size / titleTypes * 100),
        rarityCounts
    };
}

async function getRichest(_guildId, limit = 10, mode = "wallet") {
    if (!["combined", "wallet", "bank"].includes(mode)) {
        throw new UserFacingError("Leaderboard mode must be combined, wallet, or bank.");
    }
    const accounts = await getCollections().accounts.find({ bot: { $ne: true } }).toArray();
    const metric = account => mode === "wallet"
        ? Number(account.wallet || 0)
        : mode === "bank"
            ? Number(account.bank?.balance || 0)
            : Number(account.wallet || 0) + Number(account.bank?.balance || 0);
    return accounts
        .map(account => ({
            ...account,
            bankBalance: Number(account.bank?.balance || 0),
            combinedWealth: Number(account.wallet || 0) + Number(account.bank?.balance || 0),
            leaderboardValue: metric(account)
        }))
        .sort((left, right) =>
            right.leaderboardValue - left.leaderboardValue ||
            String(left.userId || left._id).localeCompare(String(right.userId || right._id))
        )
        .slice(0, Math.min(10, Math.max(1, limit)));
}

async function getEconomyStats() {
    const collections = getCollections();
    const [accountStats, transactionStats] = await Promise.all([
        collections.accounts.aggregate([
            { $match: {} },
            { $group: { _id: null, accounts: { $sum: 1 }, circulation: { $sum: "$wallet" } } }
        ]).toArray(),
        collections.transactions.aggregate([
            { $match: {} },
            {
                $group: {
                    _id: null,
                    issued: { $sum: { $ifNull: ["$currencyIssued", 0] } },
                    removed: { $sum: { $ifNull: ["$currencyRemoved", 0] } },
                    returned: { $sum: { $ifNull: ["$currencyReturned", 0] } },
                    shopPurchases: { $sum: { $cond: [{ $eq: ["$type", "shop_purchase"] }, 1, 0] } },
                    shopSales: { $sum: { $cond: [{ $eq: ["$type", "shop_sale"] }, 1, 0] } },
                    lotteryEntries: { $sum: { $cond: [{ $eq: ["$type", "lottery_entry"] }, 1, 0] } },
                    gamblingWins: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "coinflip"] }, { $eq: ["$outcome", "win"] }] }, 1, 0] } },
                    gamblingLosses: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "coinflip"] }, { $eq: ["$outcome", "loss"] }] }, 1, 0] } }
                }
            }
        ]).toArray()
    ]);
    const accounts = accountStats[0] || { accounts: 0, circulation: 0 };
    const transactions = transactionStats[0] || {};
    return {
        accounts: accounts.accounts,
        circulation: accounts.circulation,
        issued: transactions.issued || 0,
        removed: Math.max(0, (transactions.removed || 0) - (transactions.returned || 0)),
        shopPurchases: transactions.shopPurchases || 0,
        shopSales: transactions.shopSales || 0,
        lotteryEntries: transactions.lotteryEntries || 0,
        gamblingWins: transactions.gamblingWins || 0,
        gamblingLosses: transactions.gamblingLosses || 0
    };
}

async function getCurrentLottery(guildId, now = new Date()) {
    const { roundId, startAt, endAt } = getDailyRound(now);
    const id = `${guildId}:${roundId}`;
    const collection = getCollections().rounds;
    try {
        await collection.updateOne(
            { _id: id },
            {
                $setOnInsert: {
                    guildId,
                    roundId,
                    state: "open",
                    ticketPrice: config.lottery.ticketPrice,
                    prizePool: 0,
                    participants: 0,
                    startAt,
                    endAt,
                    createdAt: now
                }
            },
            { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    const round = await collection.findOne({ _id: id });
    if (!round) throw new Error("The current lottery round could not be initialized.");
    return round;
}

async function listShop(guildId, userId, now = new Date()) {
    const ownedTitles = await getCollections().titles.find({ userId }, { projection: { titleId: 1 } }).toArray();
    const ownedIds = new Set(ownedTitles.map(title => title.titleId));
    return Promise.all(catalog.map(async item => ({
        item,
        owned: ownedIds.has(item.id),
        stock: item.weeklyStock ? await getLimitedStock(guildId, item, now) : null
    })));
}

async function refreshBankState(account) {
    const now = new Date();
    const lots = (account?.bank?.lots || []).map(lot => ({
        ...lot,
        remaining: Math.max(0, Number(lot.remaining ?? lot.principal ?? 0))
    }));
    const locked = lots
        .filter(lot => new Date(lot.unlockAt).getTime() > now.getTime())
        .reduce((sum, lot) => sum + (lot.remaining || 0), 0);
    const unlocked = lots
        .filter(lot => new Date(lot.unlockAt).getTime() <= now.getTime())
        .reduce((sum, lot) => sum + (lot.remaining || 0), 0);
    return {
        balance: Number(account?.bank?.balance || 0),
        locked,
        unlocked,
        totalFeesPaid: Number(account?.bank?.totalFeesPaid || 0),
        totalDepositFeesPaid: Number(account?.bank?.totalDepositFeesPaid || 0),
        totalWithdrawalFeesPaid: Number(account?.bank?.totalWithdrawalFeesPaid || 0),
        totalDeposits: Number(account?.bank?.totalDeposits || 0),
        totalWithdrawals: Number(account?.bank?.totalWithdrawals || 0),
        lots,
        depositCount: Number(account?.bank?.depositCount || 0),
        depositPeriodId: account?.bank?.depositPeriodId || "",
        nextUnlockAt: lots
            .filter(lot => (lot.remaining || 0) > 0 && new Date(lot.unlockAt).getTime() > now.getTime())
            .sort((left, right) => new Date(left.unlockAt).getTime() - new Date(right.unlockAt).getTime())[0]?.unlockAt || null
    };
}

function getBankDepositPeriod(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kathmandu",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function getBankSummary(guildId, userId) {
    const account = await getAccount(guildId, userId);
    const summary = await refreshBankState(account);
    const periodId = getBankDepositPeriod();
    return {
        ...summary,
        depositCount: summary.depositPeriodId === periodId ? summary.depositCount : 0,
        wallet: Number(account.wallet || 0),
        combinedWealth: Number(account.wallet || 0) + Number(summary.balance || 0)
    };
}

async function requestBankDeposit({ guildId, userId, amount, now = new Date() }) {
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
        throw new UserFacingError("Enter a positive whole-number deposit amount.");
    }
    const fee = Math.floor(safeAmount / 50);
    const totalDeduction = safeAmount + fee;
    if (!Number.isSafeInteger(totalDeduction)) {
        throw new UserFacingError("That deposit exceeds the safe currency limit.");
    }
    const account = await ensureAccount(guildId, userId, now);
    const periodId = getBankDepositPeriod(now);
    const bank = account.bank || {};
    const depositCount = bank.depositPeriodId === periodId ? Number(bank.depositCount || 0) : 0;
    if (depositCount >= 10) {
        throw new UserFacingError("You have reached the daily bank deposit limit for this period.");
    }
    if (Number(account.wallet || 0) < totalDeduction) {
        throw new UserFacingError(`You need ${totalDeduction} coins for the principal and fee.`);
    }
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    await getCollections().bankDepositConfirmations.insertOne({
        _id: token,
        token,
        userId,
        guildId,
        amount: safeAmount,
        fee,
        totalDeduction,
        expiresAt,
        createdAt: now
    });
    return { token, amount: safeAmount, fee, totalDeduction, expiresAt };
}

async function confirmBankDeposit({ userId, token, amount, now = new Date() }) {
    const confirmation = await getCollections().bankDepositConfirmations.findOne({
        _id: token,
        userId,
        expiresAt: { $gt: now }
    });
    if (!confirmation) {
        throw new UserFacingError("That deposit confirmation is invalid, expired, or belongs to another user.");
    }
    if (Number(amount) !== confirmation.amount) {
        throw new UserFacingError("The confirmed deposit amount does not match the fee preview.");
    }
    const result = await depositToBank({
        guildId: confirmation.guildId,
        userId,
        amount: confirmation.amount,
        operationId: `bank-deposit:${confirmation.token}`,
        now
    });
    await getCollections().bankDepositConfirmations.deleteOne({ _id: token, userId });
    return result;
}

async function depositToBank({ guildId, userId, amount, operationId, now = new Date() }) {
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
        throw new UserFacingError("Enter a positive whole-number deposit amount.");
    }
    await ensureAccount(guildId, userId, now);
    if (userId !== BANK_FEE_RECIPIENT_ID) await ensureAccount(guildId, BANK_FEE_RECIPIENT_ID, now);
    const key = accountId(userId);
    const fee = Math.floor(safeAmount / 50);
    const total = safeAmount + fee;
    if (!Number.isSafeInteger(total)) {
        throw new UserFacingError("That deposit exceeds the safe currency limit.");
    }
    return withOperation(guildId, userId, operationId, "bank_deposit", async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        const periodId = getBankDepositPeriod(now);
        const bank = account.bank || { balance: 0, totalDeposits: 0, totalWithdrawals: 0, totalFeesPaid: 0, lots: [], depositPeriodId: "", depositCount: 0 };
        const currentCount = bank.depositPeriodId === periodId ? Number(bank.depositCount || 0) : 0;
        if (currentCount >= 10) {
            throw new UserFacingError("You have reached the daily bank deposit limit for this period.");
        }
        if (account.wallet < total) {
            throw new UserFacingError(`You need ${total} coins for the principal and fee.`);
        }
        const lot = {
            _id: `${userId}:${operationId}`,
            principal: safeAmount,
            remaining: safeAmount,
            fee,
            createdAt: now,
            unlockAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
            locked: true,
            status: "locked"
        };
        let feeRecipient = null;
        if (fee > 0) {
            feeRecipient = await collections.accounts.findOne({ _id: BANK_FEE_RECIPIENT_ID }, { session });
            if (!feeRecipient) throw new Error("The configured bank fee recipient account could not be initialized.");
            assertSafeCredit(feeRecipient.wallet, fee);
        }
        const nextBalance = Number(bank.balance || 0) + safeAmount;
        const nextFees = Number(bank.totalFeesPaid || 0) + fee;
        const nextTotalDeposits = Number(bank.totalDeposits || 0) + safeAmount;
        if (!Number.isSafeInteger(nextBalance) || !Number.isSafeInteger(nextFees) ||
            !Number.isSafeInteger(nextTotalDeposits)) {
            throw new UserFacingError("That deposit exceeds the safe bank limit.");
        }
        const nextLots = [...(bank.lots || []), lot];
        assertUpdated(await collections.accounts.updateOne(
            { _id: key, wallet: { $gte: total } },
            {
                $inc: {
                    wallet: -total,
                    "stats.totalSpent": total,
                    "stats.bankFeesPaid": fee,
                    "stats.bankDeposits": 1
                },
                $set: {
                    "bank.balance": nextBalance,
                    "bank.totalFeesPaid": nextFees,
                    "bank.totalDepositFeesPaid": Number(bank.totalDepositFeesPaid || 0) + fee,
                    "bank.totalDeposits": nextTotalDeposits,
                    "bank.depositPeriodId": periodId,
                    "bank.depositCount": currentCount + 1,
                    "bank.lots": nextLots
                }
            },
            { session }
        ), "Your balance changed before the deposit could complete.");
        if (feeRecipient) {
            assertUpdated(await collections.accounts.updateOne(
                { _id: BANK_FEE_RECIPIENT_ID, wallet: { $lte: Number.MAX_SAFE_INTEGER - fee } },
                { $inc: { wallet: fee, "stats.totalReceived": fee } },
                { session }
            ), "The configured fee recipient could not receive the deposit fee.");
        }
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "bank_deposit", safeAmount, {
                fee,
                netWalletDeduction: total,
                balanceBefore: account.wallet,
                balanceAfter: account.wallet - total,
                createdAt: now,
                metadata: {
                    principal: safeAmount,
                    fee,
                    feeRecipientUserId: fee > 0 ? BANK_FEE_RECIPIENT_ID : null,
                    lotId: lot._id,
                    unlockAt: lot.unlockAt
                }
            }
        ), { session });
        if (feeRecipient) {
            await collections.transactions.insertOne(counterpartyTransactionDocument(
                `${operationId}:bank-fee`, guildId, BANK_FEE_RECIPIENT_ID, "bank_fee_received", fee, {
                    counterpartyUserId: userId,
                    createdAt: now,
                    relatedOperationId: operationId,
                    metadata: { fee, source: "bank_deposit" }
                }
            ), { session });
        }
        return {
            principal: safeAmount,
            fee,
            totalDeduction: total,
            walletAfter: account.wallet - total,
            bankBalance: nextBalance,
            lotId: lot._id,
            unlockAt: lot.unlockAt,
            feeRecipientUserId: fee > 0 ? BANK_FEE_RECIPIENT_ID : null,
            periodId,
            depositCount: currentCount + 1
        };
    });
}

async function withdrawFromBank({ guildId, userId, amount, operationId, now = new Date() }) {
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
        throw new UserFacingError("Enter a positive whole-number withdrawal amount.");
    }
    await ensureAccount(guildId, userId, now);
    if (userId !== BANK_FEE_RECIPIENT_ID) await ensureAccount(guildId, BANK_FEE_RECIPIENT_ID, now);
    const key = accountId(userId);
    return withOperation(guildId, userId, operationId, "bank_withdrawal", async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: key }, { session });
        if (!account) throw new UserFacingError("Your economy account could not be found.");
        const bank = account.bank || { balance: 0, lots: [] };
        const lots = [...(bank.lots || [])].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        const unlockedLots = lots.filter(lot => new Date(lot.unlockAt).getTime() <= now.getTime() && (lot.remaining || 0) > 0);
        const unlockedBalance = unlockedLots.reduce((sum, lot) => sum + (lot.remaining || 0), 0);
        if (unlockedBalance < safeAmount) {
            throw new UserFacingError("You do not have enough unlocked bank funds to withdraw that amount.");
        }
        const fee = safeAmount > 10000 ? Math.floor(safeAmount / 100) : 0;
        const net = safeAmount - fee;
        let feeRecipient = null;
        if (fee > 0) {
            feeRecipient = await collections.accounts.findOne({ _id: BANK_FEE_RECIPIENT_ID }, { session });
            if (!feeRecipient) throw new Error("The configured bank fee recipient account could not be initialized.");
            assertSafeCredit(feeRecipient.wallet, fee);
        }
        const updatedLots = lots.map(lot => ({ ...lot }));
        const allocations = [];
        let remainingToWithdraw = safeAmount;
        for (const lot of updatedLots) {
            if (remainingToWithdraw <= 0) break;
            if (new Date(lot.unlockAt).getTime() > now.getTime() || (lot.remaining || 0) <= 0) continue;
            const deducted = Math.min(remainingToWithdraw, lot.remaining || 0);
            lot.remaining = Number((lot.remaining || 0) - deducted);
            allocations.push({
                lotId: lot._id,
                principal: deducted,
                createdAt: lot.createdAt,
                unlockAt: lot.unlockAt,
                statusAtWithdrawal: "unlocked"
            });
            lot.status = lot.remaining <= 0
                ? "completed"
                : new Date(lot.unlockAt).getTime() > now.getTime() ? "locked" : "unlocked";
            lot.locked = new Date(lot.unlockAt).getTime() > now.getTime() && lot.remaining > 0;
            remainingToWithdraw -= deducted;
        }
        const newBalance = Number(bank.balance || 0) - safeAmount;
        const newTotalWithdrawals = Number(bank.totalWithdrawals || 0) + safeAmount;
        const newTotalFees = Number(bank.totalFeesPaid || 0) + fee;
        const completedLots = allocations.filter(lot =>
            new Date(lot.createdAt).getTime() + 12 * 60 * 60 * 1000 <= now.getTime()
        ).length;
        if (!Number.isSafeInteger(newBalance) || !Number.isSafeInteger(newTotalWithdrawals) ||
            !Number.isSafeInteger(newTotalFees)) {
            throw new UserFacingError("That withdrawal exceeds the safe bank limit.");
        }
        assertUpdated(await collections.accounts.updateOne(
            { _id: key, "bank.balance": { $gte: safeAmount } },
            {
                $inc: {
                    wallet: net,
                    "stats.totalReceived": net,
                    "stats.bankWithdrawals": safeAmount,
                    ...(safeAmount === 10000 ? { "stats.feeFreeWithdrawals": 1 } : {}),
                    ...(completedLots ? { "stats.longTermSavedWithdrawals": completedLots } : {})
                },
                $set: {
                    "bank.balance": newBalance,
                    "bank.totalWithdrawals": newTotalWithdrawals,
                    "bank.totalFeesPaid": newTotalFees,
                    "bank.totalWithdrawalFeesPaid": Number(bank.totalWithdrawalFeesPaid || 0) + fee,
                    "bank.lots": updatedLots
                }
            },
            { session }
        ), "The bank balance changed before the withdrawal could complete.");
        if (feeRecipient) {
            assertUpdated(await collections.accounts.updateOne(
                { _id: BANK_FEE_RECIPIENT_ID, wallet: { $lte: Number.MAX_SAFE_INTEGER - fee } },
                { $inc: { wallet: fee, "stats.totalReceived": fee } },
                { session }
            ), "The configured fee recipient could not receive the withdrawal fee.");
        }
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, userId, "bank_withdrawal", safeAmount, {
                fee,
                netWalletCredit: net,
                balanceBefore: account.wallet,
                balanceAfter: account.wallet + net,
                createdAt: now,
                metadata: {
                    principal: safeAmount,
                    fee,
                    net,
                    feeRecipientUserId: fee > 0 ? BANK_FEE_RECIPIENT_ID : null,
                    allocations,
                    lots: updatedLots.map(lot => ({ _id: lot._id, remaining: lot.remaining, unlockAt: lot.unlockAt }))
                }
            }
        ), { session });
        if (feeRecipient) {
            await collections.transactions.insertOne(counterpartyTransactionDocument(
                `${operationId}:bank-fee`, guildId, BANK_FEE_RECIPIENT_ID, "bank_fee_received", fee, {
                    counterpartyUserId: userId,
                    createdAt: now,
                    relatedOperationId: operationId,
                    metadata: { fee, source: "bank_withdrawal" }
                }
            ), { session });
        }
        return {
            principal: safeAmount,
            fee,
            net,
            walletAfter: account.wallet + net,
            bankBalance: newBalance,
            feeRecipientUserId: fee > 0 ? BANK_FEE_RECIPIENT_ID : null,
            lotCount: updatedLots.length
        };
    });
}

async function listBankHistory(guildId, userId, page = 1, pageSize = 10) {
    const skip = Math.max(0, (Number(page) - 1) * pageSize);
    const collection = getCollections().transactions;
    const rows = await collection.find({
        actorUserId: userId,
        type: { $in: ["bank_deposit", "bank_withdrawal"] }
    }).sort({ createdAt: -1 }).skip(skip).limit(pageSize).toArray();
    return rows;
}

async function getAchievementSummary(guildId, userId) {
    await ensureAccount(guildId, userId);
    const collections = getCollections();
    const session = getClient().startSession();
    try {
        await session.withTransaction(async () => {
            await updateAchievementsForUser(collections, userId, session);
        });
    } finally {
        await session.endSession();
    }
    const account = await collections.accounts.findOne({ _id: userId });
    const { getAchievementCatalog } = require("./economy-achievements");
    const ACHIEVEMENTS = getAchievementCatalog();
    const unlocked = new Set(account?.achievements?.unlocked || []);
    const earned = ACHIEVEMENTS.filter(achievement => unlocked.has(achievement.id));
    const total = ACHIEVEMENTS.length;
    const progress = Math.round((earned.length / total) * 100);
    const rarityRank = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5, Mythic: 6 };
    const hardest = [...earned].sort((left, right) =>
        (right.difficulty || 0) - (left.difficulty || 0) ||
        (rarityRank[right.rarity] || 0) - (rarityRank[left.rarity] || 0) ||
        left.id.localeCompare(right.id)
    ).slice(0, 3);
    const recent = [...earned].sort((left, right) =>
        new Date(account.achievements?.unlockedAt?.[right.id] || 0) -
        new Date(account.achievements?.unlockedAt?.[left.id] || 0) ||
        left.id.localeCompare(right.id)
    ).slice(0, 3);
    const completionTag = await collections.titles.findOne({
        userId,
        titleId: "the-dark-knight"
    });
    return {
        total,
        earnedCount: earned.length,
        completionPercent: progress,
        unlocked: earned.map(item => item.id),
        recent,
        strongest: hardest,
        progress: account.achievements?.progress || {},
        completionTagUnlocked: Boolean(completionTag)
    };
}

function assertEconomyAdmin(adminUserId) {
    if (adminUserId !== ECONOMY_ADMIN_ID) {
        throw new UserFacingError("You are not authorized to administer the global economy.");
    }
}

async function adminWalletChange({ guildId, adminUserId, targetUserId, action, amount, operationId }) {
    assertEconomyAdmin(adminUserId);
    if (!["add", "remove", "set"].includes(action)) throw new TypeError("Unknown administrative wallet action.");
    if (typeof targetUserId !== "string" || !targetUserId) throw new UserFacingError("Choose a target user.");
    if (!Number.isSafeInteger(amount) || amount < 0 || (action !== "set" && amount === 0)) {
        throw new UserFacingError("Enter a valid nonnegative whole-number amount.");
    }
    await ensureAccount(guildId, targetUserId);
    return withOperation(guildId, adminUserId, operationId, `admin_wallet_${action}`, async session => {
        const collections = getCollections();
        const account = await collections.accounts.findOne({ _id: targetUserId }, { session });
        if (!account) throw new UserFacingError("The target economy account could not be found.");
        const before = Number(account.wallet || 0);
        const after = action === "add" ? before + amount : action === "remove" ? before - amount : amount;
        if (!Number.isSafeInteger(after) || after < 0) {
            throw new UserFacingError(action === "remove"
                ? "The target does not have enough wallet coins."
                : "That wallet change exceeds the safe integer limit.");
        }
        assertUpdated(await collections.accounts.updateOne(
            { _id: targetUserId, wallet: before },
            { $set: { wallet: after } },
            { session }
        ), "The target wallet changed before the administrative action could complete.");
        const delta = after - before;
        await collections.transactions.insertOne(transactionDocument(
            operationId, guildId, targetUserId, `admin_wallet_${action}`, Math.abs(delta), {
                adminUserId,
                balanceBefore: before,
                balanceAfter: after,
                currencyIssued: Math.max(0, delta),
                currencyRemoved: Math.max(0, -delta),
                createdAt: new Date(),
                metadata: { action, requestedAmount: amount }
            }
        ), { session });
        await collections.adminAudit.insertOne({
            _id: operationId,
            adminUserId,
            targetUserId,
            action,
            requestedAmount: amount,
            balanceBefore: before,
            balanceAfter: after,
            guildId,
            createdAt: new Date()
        }, { session });
        return { action, targetUserId, amount, balanceBefore: before, balanceAfter: after };
    });
}

async function requestBalanceReset({ guildId, adminUserId, targetUserId = null }) {
    assertEconomyAdmin(adminUserId);
    const scope = targetUserId ? "user" : "global";
    if (targetUserId) await ensureAccount(guildId, targetUserId);
    const collections = getCollections();
    const affectedAccountCount = targetUserId
        ? await collections.accounts.countDocuments({ _id: targetUserId })
        : await collections.accounts.countDocuments({});
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    await collections.adminConfirmations.insertOne({
        _id: token,
        token,
        scope,
        targetUserId,
        initiatedBy: adminUserId,
        affectedAccountCount,
        createdAt: now,
        expiresAt
    });
    return { token, scope, targetUserId, affectedAccountCount, expiresAt };
}

async function confirmBalanceReset({ guildId, adminUserId, token, scope, operationId }) {
    assertEconomyAdmin(adminUserId);
    if (!["user", "global"].includes(scope)) throw new UserFacingError("That reset scope is invalid.");
    return withOperation(guildId, adminUserId, operationId, `admin_reset_${scope}`, async session => {
        const collections = getCollections();
        const now = new Date();
        const confirmation = await collections.adminConfirmations.findOne({
            _id: token,
            initiatedBy: adminUserId,
            scope,
            expiresAt: { $gt: now }
        }, { session });
        if (!confirmation) {
            throw new UserFacingError("That reset confirmation is invalid, expired, or belongs to another administrator.");
        }
        const filter = scope === "user" ? { _id: confirmation.targetUserId } : {};
        const accounts = await collections.accounts.find(filter, { session }).toArray();
        if (accounts.length !== confirmation.affectedAccountCount) {
            throw new UserFacingError("The affected account count changed. Request a fresh reset confirmation.");
        }
        for (const account of accounts) {
            const previousBalance = Number(account.wallet || 0);
            assertUpdated(await collections.accounts.updateOne(
                { _id: account._id, wallet: account.wallet },
                { $set: { wallet: config.startingBalance } },
                { session }
            ), "An account balance changed during reset; no reset was applied.");
            const delta = config.startingBalance - previousBalance;
            const ledgerId = `${operationId}:reset:${account._id}`;
            await collections.transactions.insertOne(transactionDocument(
                ledgerId, guildId, account.userId || account._id, "admin_wallet_reset", Math.abs(delta), {
                    adminUserId,
                    balanceBefore: previousBalance,
                    balanceAfter: config.startingBalance,
                    currencyIssued: Math.max(0, delta),
                    currencyRemoved: Math.max(0, -delta),
                    createdAt: now,
                    metadata: { scope, resetTo: config.startingBalance }
                }
            ), { session });
        }
        await collections.adminAudit.insertOne({
            _id: operationId,
            adminUserId,
            scope,
            targetUserId: confirmation.targetUserId || null,
            affectedAccountCount: accounts.length,
            resetTo: config.startingBalance,
            guildId,
            createdAt: now
        }, { session });
        await collections.adminConfirmations.deleteOne({ _id: token }, { session });
        return { scope, affectedAccountCount: accounts.length, resetTo: config.startingBalance };
    });
}

async function runEconomyOperation(guildId, userId, operationId, name, action) {
    await ensureAccount(guildId, userId);
    return withOperation(guildId, userId, operationId, name, action);
}

async function creditWordleReward({ guildId, userId, challengeId, amount }) {
    if (typeof challengeId !== "string" || !challengeId ||
        typeof userId !== "string" || !userId ||
        !Number.isSafeInteger(amount) || amount <= 0) {
        throw new TypeError("A valid Wordle reward, winner, and challenge ID are required.");
    }
    await ensureAccount(guildId, userId);
    const collections = getCollections();
    const operationId = `wordle:${challengeId}`;
    const session = getClient().startSession();
    try {
        let balanceAfter;
        await session.withTransaction(async () => {
            const previous = await collections.transactions.findOne(
                { _id: operationId },
                { session }
            );
            if (previous) {
                if (previous.type !== "wordle_reward" ||
                    previous.actorUserId !== userId ||
                    previous.amount !== amount) {
                    throw new Error("The Wordle reward idempotency key is already associated with a different payment.");
                }
                balanceAfter = previous.balanceAfter;
                return;
            }

            const account = await collections.accounts.findOne({ _id: userId }, { session });
            if (!account) throw new Error("The winner economy account could not be initialized.");
            const balanceBefore = Number(account.wallet || 0);
            assertSafeCredit(balanceBefore, amount);
            balanceAfter = balanceBefore + amount;
            assertUpdated(await collections.accounts.updateOne(
                { _id: userId, wallet: balanceBefore },
                { $inc: { wallet: amount, "stats.totalEarned": amount } },
                { session }
            ), "The winner's wallet changed before the Wordle prize could be credited.");
            await collections.transactions.insertOne(transactionDocument(
                operationId,
                guildId,
                userId,
                "wordle_reward",
                amount,
                {
                    currencyIssued: amount,
                    balanceBefore,
                    balanceAfter,
                    createdAt: new Date(),
                    metadata: { challengeId }
                }
            ), { session });
        });
        return { operationId, balanceAfter };
    } finally {
        await session.endSession();
    }
}

module.exports = {
    config,
    catalog,
    titles,
    consumables,
    initializeEconomyStorage,
    ensureAccount,
    getAccount,
    getExistingAccount,
    claimReward,
    claimWork,
    claimBeg,
    transfer,
    steal,
    coinflip,
    playNumberLottery,
    enterLottery,
    getCurrentLottery,
    finalizeExpiredLotteryRounds,
    startEconomyScheduler,
    getWeeklyPeriod,
    getDailyRound,
    getLimitedStock,
    buyItem,
    sellItem,
    useItem,
    equipTitle,
    getInventory,
    ownsItem,
    getBoosts,
    getCooldowns,
    listTransactions,
    getProfile,
    getRichest,
    getEconomyStats,
    listShop,
    getCatalogItem,
    createVariantCode,
    randomInclusive,
    calculateStealFine,
    getStealSuccessPercent,
    calculateStealAmount,
    resolveCoinflip,
    refreshBankState,
    getBankDepositPeriod,
    getBankSummary,
    requestBankDeposit,
    confirmBankDeposit,
    depositToBank,
    withdrawFromBank,
    listBankHistory,
    getAchievementSummary,
    adminWalletChange,
    requestBalanceReset,
    confirmBalanceReset,
    runEconomyOperation,
    creditWordleReward
};
