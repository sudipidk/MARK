const { getDB } = require("../db");

const serverCache = new Map();
const serverWriteQueues = new Map();

async function initializeCountingData() {
    const collection = getDB().collection("counting");
    const servers = await collection.find({}).toArray();

    serverCache.clear();
    for (const server of servers) {
        const { _id, ...data } = server;
        serverCache.set(_id, data);
    }

    console.log(`✅ Loaded ${servers.length} counting server(s) from MongoDB`);
}

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

function cloneServerData(data) {
    return {
        ...createServerData(),
        ...(data || {}),
        countsByUser: {
            ...((data && data.countsByUser) || {})
        },
        deletedByUser: {
            ...((data && data.deletedByUser) || {})
        }
    };
}

function getServerData(guildId) {
    return cloneServerData(serverCache.get(guildId));
}

function updateServerData(guildId, updater) {
    if (typeof guildId !== "string" || !guildId) {
        return Promise.reject(new TypeError("A guild ID is required to update counting data."));
    }
    if (typeof updater !== "function") {
        return Promise.reject(new TypeError("A counting data updater function is required."));
    }

    const previousWrite = serverWriteQueues.get(guildId) || Promise.resolve();
    const write = previousWrite.catch(() => {}).then(async () => {
        const serverData = cloneServerData(serverCache.get(guildId));
        updater(serverData);

        await getDB().collection("counting").updateOne(
            { _id: guildId },
            { $set: serverData },
            { upsert: true }
        );

        serverCache.set(guildId, serverData);
        return cloneServerData(serverData);
    });

    serverWriteQueues.set(guildId, write);
    return write.then(
        result => {
            if (serverWriteQueues.get(guildId) === write) {
                serverWriteQueues.delete(guildId);
            }
            return result;
        },
        error => {
            if (serverWriteQueues.get(guildId) === write) {
                serverWriteQueues.delete(guildId);
            }
            throw error;
        }
    );
}

function tokenize(expression) {
    if (expression.length > 100) {
        throw new Error("Expression is too long.");
    }

    const tokens = [];
    const tokenPattern =
        /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([a-z]+)|(\*\*|[+\-*/^(){}\[\]]))/iy;

    let position = 0;

    while (position < expression.length) {
        tokenPattern.lastIndex = position;

        const match = tokenPattern.exec(expression);

        if (!match) {
            throw new Error("Invalid character in expression.");
        }

        tokens.push(match[1] || match[2] || match[3]);

        if (tokens.length > 100) {
            throw new Error("Expression has too many parts.");
        }

        position = tokenPattern.lastIndex;
    }

    return tokens;
}

function evaluateExpression(expression) {
    const tokens = tokenize(expression);

    let position = 0;

    const peek = () => tokens[position];
    const consume = () => tokens[position++];

    const closingBracket = {
        "(": ")",
        "{": "}",
        "[": "]"
    };

    function parsePrimary() {
        const token = consume();

        if (token === undefined) {
            throw new Error("Expected a value.");
        }

        if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
            return Number(token);
        }

        if (
            Object.prototype.hasOwnProperty.call(
                closingBracket,
                token
            )
        ) {
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

            if (!fn) {
                throw new Error("Unsupported function.");
            }

            const opener = consume();

            if (
                !Object.prototype.hasOwnProperty.call(
                    closingBracket,
                    opener
                )
            ) {
                throw new Error(
                    "Expected brackets after function name."
                );
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

            value =
                operator === "*"
                    ? value * right
                    : value / right;
        }

        return value;
    }

    function parseAdditive() {
        let value = parseMultiplicative();

        while (peek() === "+" || peek() === "-") {
            const operator = consume();
            const right = parseMultiplicative();

            value =
                operator === "+"
                    ? value + right
                    : value - right;
        }

        return value;
    }

    if (tokens.length === 0) {
        throw new Error("Expression is empty.");
    }

    const result = parseAdditive();

    if (position !== tokens.length) {
        throw new Error("Unexpected expression part.");
    }

    return result;
}

function parseCount(message, mathEnabled) {
    const text = message.trim();

    if (/^\d+$/.test(text)) {
        const value = Number(text);

        return {
            isCount: true,
            value:
                Number.isSafeInteger(value) && value > 0
                    ? value
                    : null
        };
    }

    if (!mathEnabled) {
        return {
            isCount: false,
            value: null
        };
    }

    try {
        const value = evaluateExpression(text);

        return {
            isCount: true,
            value:
                Number.isSafeInteger(value) && value > 0
                    ? value
                    : null
        };
    } catch {
        return {
            isCount: false,
            value: null
        };
    }
}

module.exports = {
    getServerData,
    updateServerData,
    parseCount,
    initializeCountingData
};