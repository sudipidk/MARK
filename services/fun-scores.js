const { randomInt } = require("node:crypto");
const { getDB } = require("../db");
const { UserFacingError } = require("./errors");
const { readBundledJsonFile } = require("./storage");

const SCORE_RANGES = Object.freeze({
    gay: 100,
    iq: 200,
    rizz: 1000,
    luck: 100
});

function pairKey(firstUserId, secondUserId) {
    return [String(firstUserId), String(secondUserId)].sort().join(":");
}

function isValidInteger(value, maximum) {
    return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function isDuplicateKeyError(error) {
    return error && error.code === 11000;
}

function createScoreService(collection) {
    async function getPermanentScore(testId, userId, maximum = SCORE_RANGES[testId]) {
        if (!Number.isInteger(maximum) || maximum < 0) {
            throw new TypeError(`Invalid score range for ${testId}.`);
        }
        const id = `${testId}:${userId}`;
        let record = await collection.findOne({ _id: id });
        if (!record) {
            const generated = randomInt(maximum + 1);
            try {
                await collection.updateOne(
                    { _id: id },
                    {
                        $setOnInsert: {
                            _id: id,
                            testId,
                            userId: String(userId),
                            score: generated,
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;
            }
            record = await collection.findOne({ _id: id });
        }
        if (!record || !isValidInteger(record.score, maximum)) {
            throw new UserFacingError("That saved result is unavailable. Please contact a bot administrator.");
        }
        return record;
    }

    async function getLoveResult(firstUserId, secondUserId) {
        const [user1Id, user2Id] = [String(firstUserId), String(secondUserId)].sort();
        const id = `love:${pairKey(user1Id, user2Id)}`;
        let record = await collection.findOne({ _id: id });
        if (!record) {
            const catalogue = readBundledJsonFile("lovetest.json", null);
            const categories = catalogue && Array.isArray(catalogue.categories)
                ? catalogue.categories
                : [];
            if (!categories.length || categories.some(category =>
                !category || typeof category.id !== "string" ||
                !Number.isInteger(category.min) || !Number.isInteger(category.max) ||
                category.min < 0 || category.max > 100 || category.min > category.max ||
                !Array.isArray(category.messages) || category.messages.length === 0 ||
                category.messages.some(message => typeof message !== "string" || !message.trim())
            )) {
                throw new UserFacingError("Love-test messages are unavailable. Please try again later.");
            }
            const score = randomInt(101);
            const category = categories.find(item =>
                score >= item.min && score <= item.max
            );
            if (!category) {
                throw new UserFacingError("Love-test score bands are misconfigured. Please contact a bot administrator.");
            }
            const messageIndex = randomInt(category.messages.length);
            const message = category.messages[messageIndex];
            try {
                await collection.updateOne(
                    { _id: id },
                    {
                        $setOnInsert: {
                            _id: id,
                            testId: "love",
                            user1Id,
                            user2Id,
                            score,
                            categoryId: category.id,
                            messageId: `${category.id}-${messageIndex + 1}`,
                            message,
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;
            }
            record = await collection.findOne({ _id: id });
        }
        if (!record || !isValidInteger(record.score, 100) ||
            typeof record.message !== "string" ||
            typeof record.messageId !== "string" ||
            typeof record.categoryId !== "string") {
            throw new UserFacingError("That saved love-test result is unavailable. Please contact a bot administrator.");
        }
        return record;
    }

    return { getPermanentScore, getLoveResult };
}

function getService() {
    return createScoreService(getDB().collection("funScores"));
}

async function initializeFunScoreStorage() {
    const collection = getDB().collection("funScores");
    await collection.createIndex(
        { testId: 1, userId: 1 },
        { unique: true, partialFilterExpression: { userId: { $type: "string" } } }
    );
}

module.exports = {
    SCORE_RANGES,
    pairKey,
    isValidInteger,
    createScoreService,
    initializeFunScoreStorage,
    getPermanentScore: (...args) => getService().getPermanentScore(...args),
    getLoveResult: (...args) => getService().getLoveResult(...args)
};
