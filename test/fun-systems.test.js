const assert = require("node:assert/strict");
const test = require("node:test");
const { createScoreService, pairKey } = require("../services/fun-scores");
const {
    COOLDOWN_MS,
    createCharacterService,
    formatDuration
} = require("../services/fun-characters");
const {
    selectWeightedOutcome,
    validateSocialLibrary,
    renderTemplate
} = require("../services/fun-social");
const { resolveDnaTraits } = require("../services/fun-commands");
const { getCharacterCatalogue } = require("../services/fun-characters");

function createMemoryScoreCollection() {
    const records = new Map();
    return {
        records,
        async findOne({ _id }) {
            return records.get(_id) || null;
        },
        async updateOne({ _id }, update, options) {
            if (!records.has(_id) && options.upsert) {
                records.set(_id, structuredClone(update.$setOnInsert));
            }
        }
    };
}

function createMemoryCharacterCollection(initialNow = Date.now()) {
    const records = new Map();
    let now = initialNow;
    const getDate = record => {
        const value = record && record.cooldownUntil;
        const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
        return Number.isFinite(result) ? result : 0;
    };
    return {
        records,
        setNow(value) { now = value; },
        async findOne(query) {
            const record = records.get(query._id);
            if (!record) return null;
            if (query.$expr) {
                const isActive = getDate(record) > now;
                return isActive ? { ...record } : null;
            }
            return { ...record };
        },
        async findOneAndUpdate(query, pipeline, options = {}) {
            const existing = records.get(query._id);
            if (query.$expr && (!existing || getDate(existing) > now)) return null;
            if (!existing && !options.upsert) return null;
            const current = existing || { _id: query._id };
            const updates = pipeline[0].$set;
            const next = { ...current };
            for (const [key, expression] of Object.entries(updates)) {
                if (expression && expression.$ifNull) {
                    if (next[key] == null) {
                        const fallback = expression.$ifNull[1];
                        next[key] = fallback && fallback.$dateAdd
                            ? new Date(now + 24 * 60 * 60 * 1000)
                            : fallback === "$$NOW" ? new Date(now)
                                : fallback && fallback.$literal !== undefined ? fallback.$literal : fallback;
                    }
                } else if (expression === "$$NOW") {
                    next[key] = new Date(now);
                } else if (expression && expression.$dateAdd) {
                    next[key] = new Date(now + 24 * 60 * 60 * 1000);
                } else if (expression && expression.$literal !== undefined) {
                    next[key] = expression.$literal;
                } else {
                    next[key] = expression;
                }
            }
            records.set(query._id, next);
            return { ...next };
        }
    };
}

test("permanent score creation is stable under simultaneous requests", async () => {
    const collection = createMemoryScoreCollection();
    const service = createScoreService(collection);
    const [first, second] = await Promise.all([
        service.getPermanentScore("gay", "user-1"),
        service.getPermanentScore("gay", "user-1")
    ]);
    assert.equal(first.score, second.score);
    assert.equal(collection.records.size, 1);
    assert.ok(first.score >= 0 && first.score <= 100);
});

test("love pair keys normalize user order", () => {
    assert.equal(pairKey("user-a", "user-b"), pairKey("user-b", "user-a"));
});

test("DNA resolves shared traits from the permanent score service", async () => {
    const traits = [
        { id: "gay", name: "Gay", max: 100, sharedScore: "gay" },
        { id: "rizz", name: "Rizz", max: 1000, sharedScore: "rizz" },
        { id: "luck", name: "Luck", max: 100, sharedScore: "luck" },
        { id: "gamer", name: "Gamer", max: 100 }
    ];
    const shared = { gay: 42, rizz: 873, luck: 19 };
    const resolved = await resolveDnaTraits(traits, { gamer: 67 }, async id => shared[id]);
    assert.deepEqual(resolved.map(trait => trait.value), [42, 873, 19, 67]);
});

test("weighted outcomes select by category weight and reject invalid totals", () => {
    const outcomes = [
        { id: "common", weight: 90, messages: ["Common"] },
        { id: "rare", weight: 10, messages: ["Rare"] }
    ];
    assert.equal(selectWeightedOutcome(outcomes, () => 0.95).id, "rare");
    assert.throws(() => selectWeightedOutcome([
        { id: "invalid", weight: 99 }
    ]), /total exactly 100/);
    assert.equal(validateSocialLibrary("roast", { outcomes }).outcomes, outcomes);
});

test("social templates escape mass mentions and substitute supported placeholders", () => {
    assert.equal(
        renderTemplate("{authorName} roasts {target} ({targetName})", {
            authorName: "@everyone",
            target: "123456789",
            targetName: "Target"
        }),
        "@\u200beveryone roasts <@123456789> (Target)"
    );
});

test("/characters lists every character name and source without exposing messages", async () => {
    const command = require("../commands/characters");
    const catalogue = getCharacterCatalogue();
    assert.ok(catalogue.length >= 25);
    assert.ok(catalogue.every(character =>
        Object.keys(character).sort().join(",") === "name,source"
    ));

    const embeds = [];
    const interaction = {
        options: { getInteger: () => 1 },
        async reply(payload) { embeds.push(payload.embeds[0].toJSON()); }
    };
    await command.execute(interaction);

    const listedLines = embeds[0].description.split("\n");
    assert.deepEqual(
        listedLines,
        catalogue.slice(0, 20).map(character => `**${character.name}** — ${character.source}`)
    );
    assert.equal(Object.hasOwn(catalogue[0], "messages"), false);
});

test("character assignment is stable and cooldown permits only one concurrent reroll", async () => {
    const start = Date.now();
    const collection = createMemoryCharacterCollection(start);
    const service = createCharacterService(collection);
    const [first, second] = await Promise.all([
        service.getOrCreateAssignment("user-1"),
        service.getOrCreateAssignment("user-1")
    ]);
    assert.equal(first.characterId, second.characterId);
    assert.equal(first.message, second.message);

    const blocked = await service.reroll("user-1");
    assert.equal(blocked.changed, false);
    assert.equal(blocked.assignment.characterId, first.characterId);
    assert.equal(COOLDOWN_MS, 24 * 60 * 60 * 1000);
    assert.match(formatDuration(90 * 60 * 1000), /1h 30m/);

    collection.setNow(start + COOLDOWN_MS);
    const rerolls = await Promise.all([
        service.reroll("user-1"),
        service.reroll("user-1")
    ]);
    assert.equal(rerolls.filter(result => result.changed).length, 1);
    const persisted = await service.getOrCreateAssignment("user-1");
    assert.equal(persisted.characterId, rerolls.find(result => result.changed).assignment.characterId);
    assert.equal(persisted.message, rerolls.find(result => result.changed).assignment.message);
});
