const { randomInt } = require("node:crypto");
const words = require("../data/wordle-words.json");

const AUTOMATIC_REWARDS = Object.freeze({ 5: 5000, 6: 7500, 7: 10000 });
const WORD_LENGTH_DISTRIBUTION = Object.freeze({ 5: 70, 6: 20, 7: 10 });
const MINIMUM_AUTOMATIC_REWARD = 5000;
const MAXIMUM_CUSTOM_WORD_LENGTH = 15;
const DEFAULT_MAX_ATTEMPTS = 6;

const dictionary = new Set([
    ...words["5"],
    ...words["6"],
    ...words["7"],
    ...words.additional
].map(word => word.toLowerCase()));

function isValidDictionaryWord(value) {
    return typeof value === "string" &&
        /^[a-zA-Z]+$/.test(value) &&
        dictionary.has(value.toLowerCase());
}

function isValidGuess(value, answer) {
    return typeof value === "string" &&
        typeof answer === "string" &&
        /^[a-zA-Z]+$/.test(value) &&
        value.length === answer.length;
}

function validateAutomaticRewards(rewards = AUTOMATIC_REWARDS) {
    for (const length of [5, 6, 7]) {
        const reward = Number(rewards[length]);
        if (!Number.isSafeInteger(reward) || reward < MINIMUM_AUTOMATIC_REWARD) {
            throw new RangeError(`Automatic ${length}-letter Wordle rewards must be at least ${MINIMUM_AUTOMATIC_REWARD} MARK.`);
        }
    }
    return Object.fromEntries([5, 6, 7].map(length => [length, Number(rewards[length])]));
}

function generateAutomaticAnswer({
    rewards = AUTOMATIC_REWARDS,
    distribution = WORD_LENGTH_DISTRIBUTION,
    excludeWords = [],
    random = randomInt
} = {}) {
    const validRewards = validateAutomaticRewards(rewards);
    const weights = [5, 6, 7].map(length => Number(distribution[length]));
    if (weights.some(weight => !Number.isInteger(weight) || weight < 0) ||
        weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
        throw new RangeError("Wordle word-length distribution must contain nonnegative weights totaling 100.");
    }
    const selection = random(100);
    const length = selection < weights[0]
        ? 5
        : selection < weights[0] + weights[1]
            ? 6
            : 7;
    const recent = new Set(excludeWords.map(word => String(word).toLowerCase()));
    const availableAnswers = words[String(length)].filter(word => !recent.has(word));
    const answers = availableAnswers.length ? availableAnswers : words[String(length)];
    const word = answers[random(answers.length)].toUpperCase();
    return { word, reward: validRewards[length], length };
}

function evaluateGuess(guess, answer) {
    const normalizedGuess = guess.toUpperCase();
    const normalizedAnswer = answer.toUpperCase();
    if (normalizedGuess.length !== normalizedAnswer.length) {
        throw new RangeError("Guess and answer must have the same length.");
    }

    const result = Array(normalizedGuess.length).fill("gray");
    const remaining = new Map();
    for (let index = 0; index < normalizedAnswer.length; index += 1) {
        if (normalizedGuess[index] === normalizedAnswer[index]) {
            result[index] = "green";
        } else {
            remaining.set(normalizedAnswer[index], (remaining.get(normalizedAnswer[index]) || 0) + 1);
        }
    }
    for (let index = 0; index < normalizedGuess.length; index += 1) {
        if (result[index] === "green") continue;
        const count = remaining.get(normalizedGuess[index]) || 0;
        if (count > 0) {
            result[index] = "yellow";
            remaining.set(normalizedGuess[index], count - 1);
        }
    }
    return result;
}

function validateWordLists() {
    for (const length of [5, 6, 7]) {
        const list = words[String(length)];
        if (!Array.isArray(list) || list.length !== 100 ||
            list.some(word => word.length !== length || !/^[a-z]+$/.test(word))) {
            throw new Error(`The curated ${length}-letter Wordle dictionary must contain exactly 100 valid words.`);
        }
    }
}

validateWordLists();

module.exports = {
    AUTOMATIC_REWARDS,
    WORD_LENGTH_DISTRIBUTION,
    MINIMUM_AUTOMATIC_REWARD,
    MAXIMUM_CUSTOM_WORD_LENGTH,
    DEFAULT_MAX_ATTEMPTS,
    isValidDictionaryWord,
    isValidGuess,
    validateAutomaticRewards,
    generateAutomaticAnswer,
    evaluateGuess,
    validateWordLists
};
