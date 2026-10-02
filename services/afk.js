const { getDB } = require("../db");
const { UserFacingError } = require("./errors");

function afkId(guildId, userId) {
    if (!guildId || !userId) {
        throw new UserFacingError("AFK status can only be set inside a server.");
    }
    return `${guildId}:${userId}`;
}

async function initializeAfkStorage() {
    await getDB().collection("afk").createIndex(
        { guildId: 1, userId: 1 },
        { unique: true }
    );
}

async function setAfk(guildId, userId, reason, startedAt = new Date()) {
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (cleanReason.length > 500) {
        throw new UserFacingError("AFK reasons must be 500 characters or fewer.");
    }
    const record = {
        _id: afkId(guildId, userId),
        guildId,
        userId,
        reason: cleanReason || "No reason provided",
        startedAt,
        pingCount: 0
    };

    await getDB().collection("afk").replaceOne(
        { _id: record._id },
        record,
        { upsert: true }
    );
    return record;
}

async function getAfk(guildId, userId) {
    return getDB().collection("afk").findOne({
        _id: afkId(guildId, userId),
        guildId,
        userId
    });
}

async function incrementAfkPing(guildId, userId) {
    const result = await getDB().collection("afk").findOneAndUpdate(
        {
            _id: afkId(guildId, userId),
            guildId,
            userId
        },
        { $inc: { pingCount: 1 } },
        { returnDocument: "after" }
    );
    return result || null;
}

async function clearAfk(guildId, userId) {
    return getDB().collection("afk").findOneAndDelete({
        _id: afkId(guildId, userId),
        guildId,
        userId
    });
}

module.exports = {
    initializeAfkStorage,
    setAfk,
    getAfk,
    incrementAfkPing,
    clearAfk
};
