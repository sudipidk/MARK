const fs = require("fs");
const path = require("path");
const { getDataDirectory } = require("./storage");

const dataDirectory = getDataDirectory();
const dataPath = path.join(dataDirectory, "counting.json");

function createServerData() {
    return {
        channelId: null,
        mathEnabled: false,
        punishmentMinutes: 0,
        cheatEnabled: false,
        streakEnabled: false,
        talkEnabled: false,
        currentCount: 0,
        highestCount: 0,
        lastUserId: null,
        countsByUser: {},
        deletedByUser: {}
    };
}

function readData() {
    if (!fs.existsSync(dataPath)) return {};

    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Counting data file must contain a JSON object.");
    }

    return data;
}

function saveData(data) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const temporaryPath = `${dataPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryPath, dataPath);
}

function getServerData(guildId) {
    const allData = readData();
    return {
        ...createServerData(),
        ...(allData[guildId] || {}),
        countsByUser: { ...(allData[guildId]?.countsByUser || {}) },
        deletedByUser: { ...(allData[guildId]?.deletedByUser || {}) }
    };
}

function updateServerData(guildId, updater) {
    const allData = readData();
    const serverData = {
        ...createServerData(),
        ...(allData[guildId] || {}),
        countsByUser: { ...(allData[guildId]?.countsByUser || {}) },
        deletedByUser: { ...(allData[guildId]?.deletedByUser || {}) }
    };

    updater(serverData);
    allData[guildId] = serverData;
    saveData(allData);
    return serverData;
}

function tokenize(expression) {
    if (expression.length > 100) {
        throw new Error("Expression is too long.");
    }

    const tokens = [];
    const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([a-z]+)|(\*\*|[+\-*/^(){}\[\]]))/iy;
    let position = 0;

    while (position < expression.length) {
        tokenPattern.lastIndex = position;
        const match = tokenPattern.exec(expression);
        if (!match) throw new Error("Invalid character in expression.");

        tokens.push(match[1] || match[2] || match[3]);
        if (tokens.length > 100) throw new Error("Expression has too many parts.");
        position = tokenPattern.lastIndex;
    }

    return tokens;
}

function evaluateExpression(expression) {
    const tokens = tokenize(expression);
    let position = 0;
    const peek = () => tokens[position];
    const consume = () => tokens[position++];
    const closingBracket = { "(": ")", "{": "}", "[": "]" };

    function parsePrimary() {
        const token = consume();
        if (token === undefined) throw new Error("Expected a value.");

        if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
            return Number(token);
        }

        if (Object.prototype.hasOwnProperty.call(closingBracket, token)) {
            const value = parseAdditive();
            if (consume() !== closingBracket[token]) {
                throw new Error("Mismatched brackets.");
            }
            return value;
        }

        if (/^[a-z]+$/.test(token)) {
            const functions = {
                sqrt: Math.sqrt,
                abs: Math.abs,
                floor: Math.floor,
                ceil: Math.ceil,
                round: Math.round
            };
            const fn = functions[token];
            if (!fn) throw new Error("Unsupported function.");

            const opener = consume();
            if (!Object.prototype.hasOwnProperty.call(closingBracket, opener)) {
                throw new Error("Expected brackets after function name.");
            }
            const argument = parseAdditive();
            if (consume() !== closingBracket[opener]) {
                throw new Error("Mismatched brackets.");
            }
            return fn(argument);
        }

        throw new Error("Expected a number or bracket.");
    }

    function parsePower() {
        const base = parsePrimary();
        if (peek() === "^" || peek() === "**") {
            consume();
            return base ** parseUnary();
        }
        return base;
    }

    function parseUnary() {
        if (peek() === "+") {
            consume();
            return parseUnary();
        }
        if (peek() === "-") {
            consume();
            return -parseUnary();
        }
        return parsePower();
    }

    function parseMultiplicative() {
        let value = parseUnary();
        while (peek() === "*" || peek() === "/") {
            const operator = consume();
            const right = parseUnary();
            value = operator === "*" ? value * right : value / right;
        }
        return value;
    }

    function parseAdditive() {
        let value = parseMultiplicative();
        while (peek() === "+" || peek() === "-") {
            const operator = consume();
            const right = parseMultiplicative();
            value = operator === "+" ? value + right : value - right;
        }
        return value;
    }

    if (tokens.length === 0) throw new Error("Expression is empty.");
    const result = parseAdditive();
    if (position !== tokens.length) throw new Error("Unexpected expression part.");
    return result;
}

function parseCount(message, mathEnabled) {
    const text = message.trim();
    if (/^\d+$/.test(text)) {
        const value = Number(text);
        return {
            isCount: true,
            value: Number.isSafeInteger(value) && value > 0 ? value : null
        };
    }

    if (!mathEnabled) return { isCount: false, value: null };

    try {
        const value = evaluateExpression(text);
        return {
            isCount: true,
            value: Number.isSafeInteger(value) && value > 0 ? value : null
        };
    } catch {
        return { isCount: false, value: null };
    }
}

module.exports = {
    getServerData,
    updateServerData,
    parseCount
};
