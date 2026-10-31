const { getDB } = require("../db");

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    allowed: Object.freeze({
        gif: true,
        emoji: true,
        media: true,
        sticker: true,
        text: true
    }),
    moderation: Object.freeze({
        deleteMessages: true,
        timeout: Object.freeze({
            enabled: false,
            duration: 10 * 60 * 1000,
            threshold: 3,
            resetAfter: 60 * 60 * 1000
        })
    }),
    exceptions: Object.freeze({
        roles: Object.freeze([]),
        users: Object.freeze([])
    })
});

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 10_000;
const configCache = new Map();

function cacheKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
}

function cloneConfig(config) {
    return config && {
        ...config,
        allowed: { ...config.allowed },
        moderation: {
            ...config.moderation,
            timeout: { ...config.moderation.timeout }
        },
        exceptions: {
            roles: [...config.exceptions.roles],
            users: [...config.exceptions.users]
        }
    };
}

function flattenConfig(guildId, channelId, createdBy, now) {
    return {
        guildId,
        channelId,
        enabled: DEFAULT_CONFIG.enabled,
        "allowed.gif": true,
        "allowed.emoji": true,
        "allowed.media": true,
        "allowed.sticker": true,
        "allowed.text": true,
        "moderation.deleteMessages": true,
        "moderation.timeout.enabled": false,
        "moderation.timeout.duration": DEFAULT_CONFIG.moderation.timeout.duration,
        "moderation.timeout.threshold": DEFAULT_CONFIG.moderation.timeout.threshold,
        "moderation.timeout.resetAfter": DEFAULT_CONFIG.moderation.timeout.resetAfter,
        "exceptions.roles": [],
        "exceptions.users": [],
        createdBy,
        createdAt: now
    };
}

async function initializeChannelConfigStorage() {
    configCache.clear();
    const database = getDB();
    await Promise.all([
        database.collection("channel_configs").createIndex(
            { guildId: 1, channelId: 1 },
            { unique: true }
        ),
        database.collection("channel_violations").createIndex(
            { guildId: 1, channelId: 1, userId: 1 },
            { unique: true }
        ),
        database.collection("channel_violations").createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 }
        )
    ]);
}

async function getChannelConfig(guildId, channelId) {
    const key = cacheKey(guildId, channelId);
    const cached = configCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cloneConfig(cached.config);
    }

    const config = await getDB().collection("channel_configs").findOne({
        guildId,
        channelId
    });
    configCache.delete(key);
    if (configCache.size >= MAX_CACHE_ENTRIES) {
        configCache.delete(configCache.keys().next().value);
    }
    configCache.set(key, {
        config: config ? cloneConfig(config) : null,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
    return cloneConfig(config);
}

async function updateChannelConfig(guildId, channelId, changes, createdBy) {
    const now = new Date();
    const defaults = flattenConfig(guildId, channelId, createdBy, now);
    const fields = { ...changes, updatedAt: now };
    for (const field of Object.keys(fields)) {
        delete defaults[field];
    }

    await getDB().collection("channel_configs").updateOne(
        { guildId, channelId },
        {
            $setOnInsert: defaults,
            $set: fields
        },
        { upsert: true }
    );
    configCache.delete(cacheKey(guildId, channelId));
    return getChannelConfig(guildId, channelId);
}

async function resetChannelConfig(guildId, channelId) {
    const database = getDB();
    await Promise.all([
        database.collection("channel_configs").deleteOne({ guildId, channelId }),
        database.collection("channel_violations").deleteMany({ guildId, channelId })
    ]);
    configCache.delete(cacheKey(guildId, channelId));
}

async function recordChannelViolation(guildId, channelId, userId, resetAfter) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + resetAfter);
    const key = { guildId, channelId, userId };
    const expired = {
        $or: [
            { $eq: [{ $type: "$expiresAt" }, "missing"] },
            { $lte: ["$expiresAt", now] }
        ]
    };
    const collection = getDB().collection("channel_violations");
    const update = [{
        $set: {
            guildId,
            channelId,
            userId,
            violations: {
                $cond: [
                    expired,
                    1,
                    { $add: [{ $ifNull: ["$violations", 0] }, 1] }
                ]
            },
            lastViolation: now,
            expiresAt,
            timeoutApplied: {
                $cond: [expired, false, { $ifNull: ["$timeoutApplied", false] }]
            }
        }
    }];
    try {
        return await collection.findOneAndUpdate(
            key,
            update,
            { upsert: true, returnDocument: "after" }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
        return collection.findOneAndUpdate(
            key,
            update,
            { returnDocument: "after" }
        );
    }
}

async function claimChannelTimeout(guildId, channelId, userId, threshold) {
    return getDB().collection("channel_violations").findOneAndUpdate(
        {
            guildId,
            channelId,
            userId,
            violations: { $gte: threshold },
            timeoutApplied: { $ne: true }
        },
        { $set: { timeoutApplied: true } },
        { returnDocument: "after" }
    );
}

module.exports = {
    DEFAULT_CONFIG,
    initializeChannelConfigStorage,
    getChannelConfig,
    updateChannelConfig,
    resetChannelConfig,
    recordChannelViolation,
    claimChannelTimeout
};
