const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const { UserFacingError } = require("../services/errors");
const { catalog, getCatalogItem } = require("../services/economy-catalog");

const economyCommandsPath = require.resolve("../services/economy-commands");
const economyFormatPath = require.resolve("../services/economy-format");

function loadEconomyCommands(economy) {
    delete require.cache[economyCommandsPath];
    delete require.cache[economyFormatPath];
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./economy" && parent.filename === economyCommandsPath) return economy;
        if (request === "./economy-format" && parent.filename === economyCommandsPath) {
            const formatter = originalLoad.call(this, request, parent, isMain);
            return {
                ...formatter,
                getTitleAwareDisplayName: async (_guildId, user, member) =>
                    member?.displayName || user.globalName || user.username
            };
        }
        if (request === "../db" && parent.filename === economyFormatPath) {
            return { getDB: () => ({ collection: () => ({ findOne: async () => null }) }) };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(economyCommandsPath);
    } finally {
        Module._load = originalLoad;
    }
}

function createInteraction({ userId = "user", subcommand = null, amount = null, choice = null, item = null, page = null } = {}) {
    const user = { id: userId, username: "TestUser", globalName: "Test User", bot: false };
    const member = {
        user,
        displayName: "Test User",
        displayAvatarURL: () => "https://example.com/avatar.png"
    };
    const calls = { deferred: [], replies: [] };
    const interaction = {
        id: "interaction-id",
        user,
        guildId: "guild-id",
        guild: {
            id: "guild-id",
            name: "Test Guild",
            members: {
                cache: new Map([[userId, member]]),
                fetch: async () => member
            }
        },
        client: {
            users: {
                cache: new Map([[userId, user]]),
                fetch: async () => user
            }
        },
        options: {
            getSubcommand: () => subcommand,
            getInteger: name => name === "amount" ? amount : name === "page" ? page : null,
            getString: name => name === "choice" ? choice : name === "item" ? item : null,
            getUser: () => null
        },
        deferred: false,
        replied: false,
        async deferReply(options) {
            calls.deferred.push(options);
            this.deferred = true;
        },
        async editReply(payload) {
            calls.replies.push(payload);
            return payload;
        },
        async reply(payload) {
            calls.replies.push(payload);
            this.replied = true;
            return payload;
        },
        async followUp(payload) {
            calls.replies.push(payload);
            return payload;
        }
    };
    return { interaction, calls, member };
}

test("coinflip command requires Heads/Tails and a compact wager string without a hard cap", () => {
    const command = require("../commands/cf");
    const options = command.data.toJSON().options;
    assert.equal(options[0].name, "choice");
    assert.equal(options[0].required, true);
    assert.deepEqual(options[0].choices.map(choice => choice.value), ["heads", "tails"]);
    assert.equal(options[1].name, "amount");
    assert.equal(options[1].type, 3);
    assert.equal(options[1].required, true);
    assert.equal(options[1].max_value, undefined);
});

test("coinflip response is public and reports choice, result, payout, boost chance, and balance", async () => {
    let wager;
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        coinflip: async args => {
            wager = args;
            return {
                won: true,
                choice: args.choice,
                result: args.choice,
                stake: args.stake,
                payout: args.stake * 2,
                net: args.stake,
                balance: 12500,
                winPercent: 63,
                luckItem: "coinflip-luck-ii"
            };
        },
        getCatalogItem
    });
    const { interaction, calls } = createInteraction({ amount: 700000, choice: "tails" });
    await handlers.executeCoinflip(interaction);
    assert.equal(calls.deferred[0].ephemeral, false);
    assert.equal(wager.stake, 700000);
    assert.equal(wager.choice, "tails");
    assert.equal(calls.replies[0].ephemeral, undefined);
    const embed = calls.replies[0].embeds[0].toJSON();
    assert.equal(embed.title, "Coinflip won");
    assert.match(embed.fields.find(field => field.name === "Your choice").value, /Tails/);
    assert.match(embed.fields.find(field => field.name === "Result").value, /Tails/);
    assert.match(embed.description, /1,400,000 coins/);
    assert.match(embed.fields.find(field => field.name === "Win chance").value, /63%.*Luck II active/);
    assert.match(embed.fields.find(field => field.name === "Wallet").value, /12,500 coins/);
});

test("coinflip invalid amounts are rejected before the economy wager call", async () => {
    let called = false;
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        coinflip: async () => { called = true; }
    });
    const { interaction } = createInteraction({ amount: 0, choice: "heads" });
    await assert.rejects(handlers.executeCoinflip(interaction), UserFacingError);
    assert.equal(called, false);
});

test("shop pages list every real catalog ID, price, stock, and command-compatible purchase syntax publicly", async () => {
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        getAccount: async () => ({}),
        listShop: async () => catalog.map(item => ({
            item,
            owned: false,
            stock: item.weeklyStock ? { available: item.weeklyStock } : null
        }))
    });
    const fields = [];
    const pageCount = Math.ceil(catalog.length / 8);
    for (let page = 1; page <= pageCount; page += 1) {
        const { interaction, calls } = createInteraction({ subcommand: "all", page });
        await handlers.executeShop(interaction);
        assert.equal(calls.deferred[0].ephemeral, false);
        const embed = calls.replies[0].embeds[0].toJSON();
        assert.equal(embed.title, "MARK Economy Shop");
        assert.match(embed.description, /\/shop buy item:<ID>/);
        assert(embed.fields.length <= 25);
        assert(embed.fields.every(field => field.value.length <= 1024));
        assert(embedLength(embed) <= 6000);
        fields.push(...embed.fields);
    }
    for (const item of catalog) {
        const field = fields.find(candidate => candidate.name === `${item.name} (${item.id})`);
        assert(field, `missing shop listing for ${item.id}`);
        assert.match(field.value, new RegExp(`\\/shop buy item:${item.id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
        assert.match(field.value, new RegExp(formatPrice(item.price)));
    }
    assert(fields.some(field => field.name === "Boosts"));
    assert(fields.some(field => field.name === "Bodyguards"));
    assert(fields.some(field => field.name === "Titles"));
});

function formatPrice(price) {
    return price.toLocaleString("en-US");
}

test("transaction history is private while public economy commands use public deferrals", async () => {
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        listTransactions: async () => []
    });
    const { interaction, calls } = createInteraction({ amount: 1 });
    interaction.options.getInteger = () => 1;
    await handlers.executeTransactions(interaction);
    assert.equal(calls.deferred[0].ephemeral, true);
    assert.equal(calls.replies[0].ephemeral, undefined);
});

test("balance embed shows wallet, bank, combined wealth, and equipped title", async () => {
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        getAccount: async () => ({
            wallet: 12345,
            equippedTitleId: "phantom",
            equippedVariantCode: null
        }),
        getBankSummary: async () => ({ balance: 5000, combinedWealth: 17345 }),
        getCatalogItem
    });
    const { interaction, calls, member } = createInteraction();
    await handlers.executeBalance(interaction);
    const embed = calls.replies[0].embeds[0].toJSON();
    assert.equal(embed.author.name, member.displayName);
    assert.equal(embed.author.icon_url, member.displayAvatarURL());
    assert.match(embed.fields.find(field => field.name === "Wallet").value, /12,345 coins/);
    assert.match(embed.fields.find(field => field.name === "Bank").value, /5,000 coins/);
    assert.match(embed.fields.find(field => field.name === "Combined wealth").value, /17,345 coins/);
    assert.match(embed.fields.find(field => field.name === "Equipped title").value, /Phantom.*Common/);
});

test("profile handles empty and populated accounts, including global effects and stats", async () => {
    let profile = {
        account: { wallet: 1000, equippedTitleId: null, stats: {} },
        inventory: { titles: [], items: [], hasMoreTitles: false },
        titleCompletion: 0,
        rarityCounts: {},
        boosts: { luckI: null, luckII: null, guards: [] }
    };
    const handlers = loadEconomyCommands({
        ensureAccount: async () => {},
        getProfile: async () => profile,
        getAchievementSummary: async () => ({
            earnedCount: 0,
            total: 41,
            completionPercent: 0,
            unlocked: [],
            recent: [],
            strongest: [],
            progress: {},
            completionTagUnlocked: false
        }),
        getCatalogItem
    });
    const empty = createInteraction();
    await handlers.executeProfile(empty.interaction);
    let embed = empty.calls.replies[0].embeds[0].toJSON();
    assert.match(embed.fields.find(field => field.name === "Titles · 0% collection").value, /None/);
    assert.match(embed.fields.find(field => field.name === "Inventory").value, /Empty/);
    assert.equal(embed.fields.some(field => /bank/i.test(field.name)), false);
    assert(embedLength(embed) <= 6000);

    const expiresAt = new Date(Date.now() + 60_000);
    profile = {
        account: {
            wallet: 98765,
            equippedTitleId: "phantom",
            stats: {
                totalEarned: 5000,
                totalSpent: 1000,
                gamblingWins: 4,
                gamblingLosses: 2,
                successfulSteals: 1,
                failedSteals: 3,
                stealFinesPaid: 150,
                stealFinesReceived: 50
            }
        },
        inventory: {
            titles: [{ item: getCatalogItem("phantom"), variantCode: null }],
            items: [{ item: getCatalogItem("coinflip-luck-i"), quantity: 2 }],
            hasMoreTitles: false
        },
        titleCompletion: 10,
        rarityCounts: { Common: 1 },
        boosts: { luckI: expiresAt, luckII: null, guards: [expiresAt] }
    };
    const populated = createInteraction();
    await handlers.executeProfile(populated.interaction);
    embed = populated.calls.replies[0].embeds[0].toJSON();
    assert.match(embed.fields.find(field => field.name === "Equipped title").value, /Phantom/);
    assert.match(embed.fields.find(field => field.name.includes("Titles")).value, /Phantom/);
    assert.match(embed.fields.find(field => field.name === "Inventory").value, /Coinflip Luck I × 2/);
    assert.match(embed.fields.find(field => field.name === "Active boosts").value, /Luck I until/);
    assert.match(embed.fields.find(field => field.name === "Active bodyguards").value, /Guard 1 until/);
    assert.match(embed.fields.find(field => field.name === "Gambling wins \/ losses").value, /4 \/ 2/);
    assert(embedLength(embed) <= 6000);
});

test("embed helper respects Discord's total embed character limit", () => {
    const { createEconomyEmbed } = require("../services/economy-embeds");
    const embed = createEconomyEmbed({
        title: "Large",
        description: "d".repeat(4096),
        fields: Array.from({ length: 25 }, (_, index) => ({
            name: `Field ${index}`,
            value: "v".repeat(1024)
        })),
        footer: "f".repeat(2048)
    }).toJSON();
    assert(embedLength(embed) <= 6000);
});

function embedLength(embed) {
    return (embed.title?.length || 0) +
        (embed.description?.length || 0) +
        (embed.author?.name.length || 0) +
        (embed.footer?.text.length || 0) +
        (embed.fields || []).reduce((total, field) => total + field.name.length + field.value.length, 0);
}

test("deferred public errors are safe and replace the public response without a private follow-up", async () => {
    const { registerInteractionHandler } = require("../services/interaction-handler");
    let listener;
    registerInteractionHandler({
        commands: new Map([["test", { execute: async () => { throw new Error("mongodb://private-secret"); } }]]),
        on: (event, handler) => {
            assert.equal(event, "interactionCreate");
            listener = handler;
        }
    });
    const calls = [];
    const interaction = {
        commandName: "test",
        deferred: true,
        replied: false,
        isChatInputCommand: () => true,
        async editReply(payload) { calls.push({ type: "edit", payload }); },
        async followUp(payload) { calls.push({ type: "followUp", payload }); }
    };
    const originalError = console.error;
    console.error = () => {};
    try {
        await listener(interaction);
    } finally {
        console.error = originalError;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "edit");
    assert.match(calls[0].payload.content, /unexpected error/i);
    assert.doesNotMatch(calls[0].payload.content, /private-secret|mongodb/);
    assert.deepEqual(calls[0].payload.allowedMentions, { parse: [] });
});
