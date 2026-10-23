const { randomInt } = require("node:crypto");
const { getDB } = require("../db");
const { UserFacingError } = require("./errors");
const { readBundledJsonFile } = require("./storage");

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getCharacterCatalogue() {
    let catalogue;
    try {
        catalogue = readBundledJsonFile("chatest.json", null);
    } catch (error) {
        console.error("Unable to load data/chatest.json:", error.message);
        throw new UserFacingError("Character data is unavailable. Please try again later.");
    }
    if (!catalogue || !Array.isArray(catalogue.characters) || !catalogue.characters.length ||
        catalogue.characters.some(character =>
            !character || typeof character.name !== "string" || !character.name.trim() ||
            typeof character.source !== "string" || !character.source.trim()
        )) {
        console.error("data/chatest.json must contain characters with names and sources.");
        throw new UserFacingError("Character names are unavailable. Please contact a bot administrator.");
    }
    return catalogue.characters.map(({ name, source }) => ({ name, source }));
}

function getEnabledCharacters() {
    let catalogue;
    try {
        catalogue = readBundledJsonFile("chatest.json", null);
    } catch (error) {
        console.error("Unable to load data/chatest.json:", error.message);
        throw new UserFacingError("Character data is unavailable. Please try again later.");
    }
    const characters = catalogue && Array.isArray(catalogue.characters)
        ? catalogue.characters.filter(character =>
            character && character.enabled === true &&
            typeof character.id === "string" && /^[a-z0-9-]+$/.test(character.id) &&
            typeof character.name === "string" &&
            Array.isArray(character.messages) &&
            character.messages.length > 0 &&
            character.messages.every(message => typeof message === "string" && message.trim())
        )
        : [];
    if (!characters.length || new Set(characters.map(character => character.id)).size !== characters.length) {
        throw new UserFacingError("No valid characters are enabled. Please contact a bot administrator.");
    }
    return characters;
}

function pickCharacterAssignment() {
    const characters = getEnabledCharacters();
    const character = characters[randomInt(characters.length)];
    const messageIndex = randomInt(character.messages.length);
    return {
        characterId: character.id,
        characterName: character.name,
        characterSource: typeof character.source === "string" ? character.source : "Unknown",
        messageId: `${character.id}-${messageIndex + 1}`,
        message: character.messages[messageIndex]
    };
}

function unwrapDocument(result) {
    return result && result.value !== undefined ? result.value : result;
}

function isValidAssignment(record) {
    return record &&
        typeof record.characterId === "string" &&
        typeof record.characterName === "string" &&
        typeof record.message === "string" &&
        Number.isFinite(new Date(record.cooldownUntil).getTime());
}

function createCharacterService(collection) {
    async function getAssignment(userId) {
        const existing = await collection.findOne({ _id: String(userId) });
        if (existing) return existing;
        const selected = pickCharacterAssignment();
        let record = unwrapDocument(await collection.findOneAndUpdate(
            { _id: String(userId) },
            [{
                $set: {
                    userId: { $ifNull: ["$userId", String(userId)] },
                    ...Object.fromEntries(Object.entries(selected).map(([key, value]) =>
                        [key, { $ifNull: [`$${key}`, { $literal: value }] }]
                    )),
                    assignedAt: { $ifNull: ["$assignedAt", "$$NOW"] },
                    cooldownUntil: {
                        $ifNull: ["$cooldownUntil", { $dateAdd: {
                            startDate: "$$NOW",
                            unit: "hour",
                            amount: 24
                        } }]
                    }
                }
            }],
            { upsert: true, returnDocument: "after" }
        ));
        if (!record) record = await collection.findOne({ _id: String(userId) });
        return record;
    }

    async function getOrCreateAssignment(userId) {
        try {
            const record = await getAssignment(userId);
            if (!isValidAssignment(record)) {
                throw new UserFacingError("That character assignment is unavailable. Please contact a bot administrator.");
            }
            return record;
        } catch (error) {
            if (error.code !== 11000) throw error;
            const record = await collection.findOne({ _id: String(userId) });
            if (!isValidAssignment(record)) throw error;
            return record;
        }
    }

    async function reroll(userId) {
        const current = await collection.findOne({ _id: String(userId) });
        if (!current) {
            return { assignment: await getOrCreateAssignment(userId), created: true, changed: false };
        }
        const previous = await collection.findOne({
            _id: String(userId),
            $expr: {
                $gt: [
                    { $convert: {
                        input: "$cooldownUntil",
                        to: "date",
                        onError: new Date(0),
                        onNull: new Date(0)
                    } },
                    "$$NOW"
                ]
            }
        });
        if (previous) {
            if (!isValidAssignment(previous)) {
                throw new UserFacingError("That character assignment is unavailable. Please contact a bot administrator.");
            }
            return { assignment: previous, created: false, changed: false };
        }

        const selected = pickCharacterAssignment();
        const updated = unwrapDocument(await collection.findOneAndUpdate(
            {
                _id: String(userId),
                $expr: {
                    $lte: [
                        { $convert: {
                            input: "$cooldownUntil",
                            to: "date",
                            onError: new Date(0),
                            onNull: new Date(0)
                        } },
                        "$$NOW"
                    ]
                }
            },
            [{
                $set: {
                    ...Object.fromEntries(Object.entries(selected).map(([key, value]) =>
                        [key, { $literal: value }]
                    )),
                    assignedAt: "$$NOW",
                    cooldownUntil: {
                        $dateAdd: { startDate: "$$NOW", unit: "hour", amount: 24 }
                    }
                }
            }],
            { returnDocument: "after" }
        ));
        if (updated) return { assignment: updated, created: false, changed: true };

        const latest = await collection.findOne({ _id: String(userId) });
        if (!latest) return { assignment: await getOrCreateAssignment(userId), created: true, changed: false };
        if (!isValidAssignment(latest)) {
            throw new UserFacingError("That character assignment is unavailable. Please contact a bot administrator.");
        }
        return { assignment: latest, created: false, changed: false };
    }

    return { getOrCreateAssignment, reroll };
}

async function initializeCharacterStorage() {
    await getDB().collection("funCharacters").createIndex({ userId: 1 }, { unique: true });
}

function getService() {
    return createCharacterService(getDB().collection("funCharacters"));
}

function getRemainingCooldown(assignment, now = Date.now()) {
    const until = assignment.cooldownUntil instanceof Date
        ? assignment.cooldownUntil.getTime()
        : new Date(assignment.cooldownUntil).getTime();
    return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

function formatDuration(milliseconds) {
    const totalMinutes = Math.ceil(milliseconds / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

module.exports = {
    COOLDOWN_MS,
    isValidAssignment,
    getCharacterCatalogue,
    createCharacterService,
    initializeCharacterStorage,
    getAssignment: userId => getService().getOrCreateAssignment(userId),
    reroll: userId => getService().reroll(userId),
    getRemainingCooldown,
    formatDuration
};
