const { randomInt } = require("node:crypto");
const path = require("node:path");
const { UserFacingError } = require("./errors");
const { readBundledJsonFile } = require("./storage");

const SAFE_FALLBACKS = {
    roast: { outcomes: [{ id: "general", weight: 100, messages: ["{targetName}, your loading screen has a loading screen."] }] },
    compliment: { outcomes: [{ id: "wholesome", weight: 100, messages: ["{targetName}, you make this place better just by being here."] }] },
    kill: { outcomes: [{ id: "ordinary", weight: 100, messages: ["{authorName} challenged {targetName} to a cartoon duel; a puff of confetti settled the score."] }] },
    kiss: { outcomes: [{ id: "friendly", weight: 100, messages: ["{authorName} sends {targetName} a friendly virtual high-five instead."] }] }
};

function validateSocialLibrary(type, library) {
    const outcomes = library && library.outcomes;
    const valid = Array.isArray(outcomes) && outcomes.length > 0 &&
        outcomes.every(outcome =>
            outcome && typeof outcome.id === "string" &&
            Number.isFinite(outcome.weight) && outcome.weight >= 0 &&
            Array.isArray(outcome.messages) && outcome.messages.length > 0 &&
            outcome.messages.every(message => typeof message === "string" && message.trim())
        ) &&
        outcomes.reduce((total, outcome) => total + outcome.weight, 0) === 100;
    if (!valid) {
        console.error(`Invalid weighted outcomes in data/${type}.json; using the safe fallback library.`);
        return SAFE_FALLBACKS[type];
    }
    return library;
}

function loadSocialLibrary(type) {
    try {
        return validateSocialLibrary(type, readBundledJsonFile(`${type}.json`, null));
    } catch (error) {
        console.error(`Unable to load data/${type}.json (${error.message}); using the safe fallback library.`);
        return SAFE_FALLBACKS[type];
    }
}

function selectWeightedOutcome(outcomes, random = Math.random) {
    const total = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
    if (!outcomes.length || outcomes.some(outcome => !Number.isFinite(outcome.weight) || outcome.weight < 0) ||
        total !== 100) {
        throw new TypeError("Outcome weights must be non-negative and total exactly 100.");
    }
    let roll = random() * 100;
    for (const outcome of outcomes) {
        roll -= outcome.weight;
        if (roll < 0) return outcome;
    }
    return outcomes[outcomes.length - 1];
}

function safeName(name) {
    return String(name || "someone")
        .replace(/@/g, "@\u200b")
        .replace(/[\r\n]/g, " ")
        .slice(0, 80);
}

function renderTemplate(template, values) {
    return template.replace(/\{(author|target|authorName|targetName)\}/g, (_match, key) =>
        key.endsWith("Name") ? safeName(values[key]) : `<@${values[key]}>`
    );
}

function createSocialResponse(type, values) {
    const library = loadSocialLibrary(type);
    const outcome = selectWeightedOutcome(library.outcomes);
    const message = outcome.messages[randomInt(outcome.messages.length)];
    return { outcomeId: outcome.id, description: renderTemplate(message, values) };
}

function getScoreDescription(type, score) {
    let library;
    try {
        library = readBundledJsonFile(`${type}.json`, null);
    } catch (error) {
        console.error(`Unable to load data/${type}.json: ${error.message}`);
        throw new UserFacingError(`${type} descriptions are unavailable. Please try again later.`);
    }
    const bands = library && Array.isArray(library.bands) ? library.bands : [];
    const band = bands.find(item =>
        Number.isInteger(item.min) && Number.isInteger(item.max) &&
        score >= item.min && score <= item.max &&
        typeof item.title === "string" && item.title.trim() &&
        Array.isArray(item.messages) && item.messages.length > 0 &&
        item.messages.every(message => typeof message === "string" && message.trim())
    );
    if (!band) {
        console.error(`No valid score band found in ${path.join(__dirname, "..", "data", `${type}.json`)} for score ${score}.`);
        throw new UserFacingError(`${type} descriptions are misconfigured. Please contact a bot administrator.`);
    }
    return {
        title: band.title,
        message: band.messages[randomInt(band.messages.length)]
    };
}

function getIqDescription(score) {
    let library;
    try {
        library = readBundledJsonFile("iq-bands.json", null);
    } catch (error) {
        console.error(`Unable to load data/iq-bands.json: ${error.message}`);
        throw new UserFacingError("IQ score descriptions are unavailable. Please try again later.");
    }
    const band = library && Array.isArray(library.bands) && library.bands.find(item =>
        Number.isInteger(item.min) && Number.isInteger(item.max) &&
        score >= item.min && score <= item.max &&
        typeof item.title === "string" && item.title.trim() &&
        typeof item.description === "string" && item.description.trim()
    );
    if (!band) {
        throw new UserFacingError("IQ score bands are misconfigured. Please contact a bot administrator.");
    }
    return band;
}

module.exports = {
    SAFE_FALLBACKS,
    validateSocialLibrary,
    loadSocialLibrary,
    selectWeightedOutcome,
    renderTemplate,
    createSocialResponse,
    getScoreDescription,
    getIqDescription
};
