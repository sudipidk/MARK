const { randomInt } = require("node:crypto");
const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { getDB } = require("../db");
const { UserFacingError } = require("./errors");
const { readBundledJsonFile } = require("./storage");
const {
    getPermanentScore,
    getLoveResult,
    initializeFunScoreStorage,
    isValidInteger,
    SCORE_RANGES
} = require("./fun-scores");
const {
    getAssignment,
    reroll,
    getRemainingCooldown,
    formatDuration,
    initializeCharacterStorage,
    getCharacterCatalogue
} = require("./fun-characters");
const { createEconomyEmbed } = require("./economy-embeds");
const {
    createSocialResponse,
    getScoreDescription,
    getIqDescription
} = require("./fun-social");

const FUN_COMMAND_NAMES = [
    "dnatest", "gaytest", "iqtest", "lovetest", "rizztest", "lucktest",
    "chatest", "charoll", "roast", "compliment", "kill", "kiss"
];
const TESTS = {
    gaytest: { score: "gay", title: "Gay Test", color: 0xEB459E, emoji: "🌈", max: 100 },
    rizztest: { score: "rizz", title: "Rizz Test", color: 0xF1C40F, emoji: "✨", max: 1000 },
    lucktest: { score: "luck", title: "Luck Test", color: 0x57F287, emoji: "🍀", max: 100 }
};
const SOCIAL_COLORS = { roast: 0xED4245, compliment: 0xF47FFF, kill: 0x5865F2, kiss: 0xEB459E };
const SOCIAL_TITLES = { roast: "Roast", compliment: "Compliment", kill: "Cartoon Duel", kiss: "Friendly Kiss" };

function createEmbed(title, color, user, description) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: "MARK • For entertainment" });
    if (user) {
        embed.setAuthor({
            name: user.username || user.displayName || "MARK user",
            iconURL: user.displayAvatarURL()
        });
        embed.setThumbnail(user.displayAvatarURL());
    }
    return embed;
}

function createErrorEmbed(error) {
    const message = error instanceof UserFacingError
        ? error.message
        : "Something went wrong while running that command. Please try again later.";
    if (!(error instanceof UserFacingError)) {
        console.error("Fun command failed:", { code: error.code || error.name });
    }
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Unable to complete command")
        .setDescription(message)
        .setFooter({ text: "MARK" });
}

function percentageBar(value, max) {
    const ratio = Math.max(0, Math.min(1, value / max));
    const filled = Math.round(ratio * 10);
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function getDisplayName(user, guild) {
    return guild && guild.members && guild.members.cache.get(user.id)?.displayName || user.globalName || user.username;
}

function getDnaDescription(traits) {
    return traits.map(trait => {
        const ratio = trait.value / trait.max;
        const percent = (ratio * 100).toFixed(Number.isInteger(ratio * 100) ? 0 : 1);
        const raw = trait.sharedScore === "rizz" ? ` (${trait.value}/1000)` : "";
        return `**${trait.name.slice(0, 40)}** ${percent}%${raw} \`${percentageBar(trait.value, trait.max)}\``;
    }).join("\n");
}

function getDnaTraits() {
    let config;
    try {
        config = readBundledJsonFile("dna-traits.json", null);
    } catch (error) {
        console.error("Unable to load data/dna-traits.json:", error.message);
        throw new UserFacingError("DNA trait data is unavailable. Please try again later.");
    }
    if (!config || !Array.isArray(config.traits) || !config.traits.length ||
        config.traits.some(trait =>
            !trait || !/^[a-z0-9-]+$/.test(trait.id) ||
            typeof trait.name !== "string" || !trait.name.trim() ||
            !Number.isInteger(trait.max) || trait.max < 1 || trait.max > 1000 ||
            (trait.sharedScore &&
                (!Object.hasOwn(SCORE_RANGES, trait.sharedScore) ||
                    trait.max !== SCORE_RANGES[trait.sharedScore]))
        ) ||
        new Set(config.traits.map(trait => trait.id)).size !== config.traits.length ||
        ["gay", "rizz", "luck"].some(sharedScore =>
            !config.traits.some(trait => trait.sharedScore === sharedScore)
        )) {
        console.error("data/dna-traits.json contains invalid traits.");
        throw new UserFacingError("DNA traits are misconfigured. Please contact a bot administrator.");
    }
    return config.traits;
}

async function initializeFunStorage() {
    await Promise.all([
        initializeFunScoreStorage(),
        initializeCharacterStorage(),
        getDB().collection("dnaProfiles").createIndex({ userId: 1 }, { unique: true })
    ]);
}

async function getDnaProfile(userId) {
    const traits = getDnaTraits();
    const collection = getDB().collection("dnaProfiles");
    const storedTraits = traits.filter(trait => !trait.sharedScore);
    try {
        await collection.updateOne(
            { _id: String(userId) },
            { $setOnInsert: { _id: String(userId), userId: String(userId), traits: {} } },
            { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
    }

    for (const trait of storedTraits) {
        const value = randomInt(trait.max + 1);
        await collection.updateOne(
            { _id: String(userId), [`traits.${trait.id}`]: { $exists: false } },
            { $set: { [`traits.${trait.id}`]: value } }
        );
    }
    const profile = await collection.findOne({ _id: String(userId) });
    if (!profile || !profile.traits || typeof profile.traits !== "object") {
        throw new UserFacingError("That DNA profile is unavailable. Please contact a bot administrator.");
    }

    return resolveDnaTraits(
        traits,
        profile.traits,
        async testId => (await getPermanentScore(testId, userId)).score
    );
}

async function resolveDnaTraits(traits, storedTraits, getSharedScore) {
    const resolved = [];
    for (const trait of traits) {
        const value = trait.sharedScore ? await getSharedScore(trait.sharedScore) : storedTraits[trait.id];
        if (!isValidInteger(value, trait.max)) {
            throw new UserFacingError(`The saved DNA trait "${trait.name}" is invalid. Please contact a bot administrator.`);
        }
        resolved.push({ ...trait, value });
    }
    return resolved;
}

function makeResponse(interaction, embed, ephemeral = false) {
    const payload = { embeds: [embed], allowedMentions: { parse: [] }, ephemeral };
    return interaction.reply(payload);
}

function getTarget(interaction) {
    return interaction.options.getUser("user") || interaction.user;
}

async function executeSlash(name, interaction) {
    try {
        if (name === "dnatest") {
            const user = getTarget(interaction);
            const traits = await getDnaProfile(user.id);
            const embed = createEmbed("🧬 Fictional DNA Profile", 0x5865F2, user, getDnaDescription(traits))
                .setFooter({ text: "MARK • Meme traits only; not science or a measure of identity, gender, or orientation" });
            await makeResponse(interaction, embed);
            return;
        }

        if (TESTS[name]) {
            const test = TESTS[name];
            const user = getTarget(interaction);
            const record = await getPermanentScore(test.score, user.id);
            const result = getScoreDescription(test.score, record.score);
            const displayScore = test.max === 1000 ? `${record.score}/1,000` : `${record.score}%`;
            const max = test.max;
            const embed = createEmbed(
                `${test.emoji} ${test.title}`,
                test.color,
                user,
                `**${displayScore} · ${result.title}**\n\`${percentageBar(record.score, max)}\`\n\n${result.message}`
            );
            if (name === "gaytest") {
                embed.setFooter({ text: "MARK • Fictional meme score; it cannot determine anyone's orientation" });
            }
            await makeResponse(interaction, embed);
            return;
        }

        if (name === "iqtest") {
            const user = getTarget(interaction);
            const { score } = await getPermanentScore("iq", user.id);
            const band = getIqDescription(score);
            const embed = createEmbed(
                "🧠 Fictional IQ-Style Test",
                0x3498DB,
                user,
                `**${score}/200 · ${band.title}**\n\`${percentageBar(score, 200)}\`\n\n${band.description}\n\nThis is a fictional entertainment score, not a measure of actual intelligence or a clinical IQ test.`
            );
            await makeResponse(interaction, embed);
            return;
        }

        if (name === "lovetest") {
            const first = interaction.options.getUser("user1");
            const second = interaction.options.getUser("user2");
            const result = await getLoveResult(first.id, second.id);
            const embed = createEmbed(
                "💞 Love Test",
                0xEB459E,
                first,
                `**<@${first.id}> + <@${second.id}> · ${result.score}%**\n\`${percentageBar(result.score, 100)}\`\n\n${result.message}`
            ).setFooter({ text: `MARK • Saved result · ${result.categoryId}` });
            await makeResponse(interaction, embed);
            return;
        }

        if (name === "chatest" || name === "charoll") {
            const user = getTarget(interaction);
            const result = name === "chatest"
                ? { assignment: await getAssignment(user.id), created: false, changed: false }
                : await reroll(user.id);
            const assignment = result.assignment;
            let description = `**${assignment.characterName}**${assignment.characterSource ? ` · ${assignment.characterSource}` : ""}\n\n“${assignment.message}”`;
            if (name === "charoll" && !result.changed && !result.created) {
                const remaining = getRemainingCooldown(assignment);
                description += `\n\n🔒 Your assignment is stable for **${formatDuration(remaining)}**.`;
            } else if (name === "charoll" && result.created) {
                description += "\n\nYour first assignment starts a 24-hour reroll cooldown.";
            } else if (name === "charoll") {
                description += "\n\n✨ New assignment! It will stay for at least 24 hours.";
            } else {
                description += "\n\nThis character stays assigned for the current 24-hour period.";
            }
            const embed = createEmbed(
                name === "chatest" ? "🎭 Your Daily Character" : "🎲 Character Roll",
                0x9B59B6,
                user,
                description
            );
            await makeResponse(interaction, embed);
            return;
        }

        if (["roast", "compliment", "kill", "kiss"].includes(name)) {
            const target = interaction.options.getUser("user");
            const description = createSocialResponse(name, {
                author: interaction.user.id,
                target: target.id,
                authorName: getDisplayName(interaction.user, interaction.guild),
                targetName: getDisplayName(target, interaction.guild)
            }).description;
            const embed = createEmbed(
                `${name === "roast" ? "🔥" : name === "compliment" ? "💖" : name === "kill" ? "🎬" : "💌"} ${SOCIAL_TITLES[name]}`,
                SOCIAL_COLORS[name],
                target,
                description
            );
            await makeResponse(interaction, embed);
        }
    } catch (error) {
        await makeResponse(interaction, createErrorEmbed(error), true);
    }
}

function resolvePrefixUser(message, token) {
    const mention = token.match(/^<@!?(\d+)>$/);
    const id = mention ? mention[1] : token;
    if (!/^\d{15,22}$/.test(id)) {
        throw new UserFacingError("Use a valid user mention or Discord user ID.");
    }
    const cached = message.mentions.users.get(id) || message.client.users.cache.get(id);
    if (cached) return Promise.resolve(cached);
    return message.client.users.fetch(id).catch(() => {
        throw new UserFacingError("I couldn't find that Discord user. Check the mention or ID and try again.");
    });
}

async function prefixTargets(message, name, args) {
    const tokens = args.trim() ? args.trim().split(/\s+/) : [];
    if (!tokens.length && name !== "lovetest" && !["roast", "compliment", "kill", "kiss"].includes(name)) {
        return [message.author];
    }
    if (name === "lovetest") {
        if (tokens.length !== 2) throw new UserFacingError("Usage: `m!lovetest @user1 @user2`.");
        return Promise.all(tokens.map(token => resolvePrefixUser(message, token)));
    }
    if (["roast", "compliment", "kill", "kiss"].includes(name)) {
        if (tokens.length !== 1) throw new UserFacingError(`Usage: \`m!${name} @user\`.`);
        return [await resolvePrefixUser(message, tokens[0])];
    }
    if (tokens.length > 1) throw new UserFacingError(`Usage: \`m!${name} [@user]\`.`);
    return [tokens.length ? await resolvePrefixUser(message, tokens[0]) : message.author];
}

async function executePrefix(name, message, args) {
    try {
        const targets = await prefixTargets(message, name, args);
        const [target] = targets;
        const author = message.author;

        if (name === "lovetest") {
            const [first, second] = targets;
            const result = await getLoveResult(first.id, second.id);
            const embed = createEmbed(
                "💞 Love Test",
                0xEB459E,
                first,
                `**<@${first.id}> + <@${second.id}> · ${result.score}%**\n\`${percentageBar(result.score, 100)}\`\n\n${result.message}`
            ).setFooter({ text: `MARK • Saved result · ${result.categoryId}` });
            await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            return;
        }

        if (name === "dnatest") {
            const traits = await getDnaProfile(target.id);
            await message.reply({
                embeds: [createEmbed("🧬 Fictional DNA Profile", 0x5865F2, target, getDnaDescription(traits))
                    .setFooter({ text: "MARK • Meme traits only; not science or a measure of identity, gender, or orientation" })],
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (TESTS[name]) {
            const test = TESTS[name];
            const { score } = await getPermanentScore(test.score, target.id);
            const result = getScoreDescription(test.score, score);
            const displayScore = test.max === 1000 ? `${score}/1,000` : `${score}%`;
            const embed = createEmbed(
                `${test.emoji} ${test.title}`,
                test.color,
                target,
                `**${displayScore} · ${result.title}**\n\`${percentageBar(score, test.max)}\`\n\n${result.message}`
            );
            if (name === "gaytest") embed.setFooter({ text: "MARK • Fictional meme score; it cannot determine anyone's orientation" });
            await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            return;
        }

        if (name === "iqtest") {
            const { score } = await getPermanentScore("iq", target.id);
            const band = getIqDescription(score);
            await message.reply({
                embeds: [createEmbed(
                    "🧠 Fictional IQ-Style Test",
                    0x3498DB,
                    target,
                    `**${score}/200 · ${band.title}**\n\`${percentageBar(score, 200)}\`\n\n${band.description}\n\nThis is a fictional entertainment score, not a measure of actual intelligence or a clinical IQ test.`
                )],
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (name === "chatest" || name === "charoll") {
            const result = name === "chatest"
                ? { assignment: await getAssignment(target.id), created: false, changed: false }
                : await reroll(target.id);
            const assignment = result.assignment;
            let description = `**${assignment.characterName}**${assignment.characterSource ? ` · ${assignment.characterSource}` : ""}\n\n“${assignment.message}”`;
            if (name === "charoll" && !result.changed && !result.created) {
                description += `\n\n🔒 Your assignment is stable for **${formatDuration(getRemainingCooldown(assignment))}**.`;
            } else if (name === "charoll" && result.created) {
                description += "\n\nYour first assignment starts a 24-hour reroll cooldown.";
            } else if (name === "charoll") {
                description += "\n\n✨ New assignment! It will stay for at least 24 hours.";
            } else {
                description += "\n\nThis character stays assigned for the current 24-hour period.";
            }
            await message.reply({ embeds: [createEmbed(
                name === "chatest" ? "🎭 Your Daily Character" : "🎲 Character Roll",
                0x9B59B6,
                target,
                description
            )], allowedMentions: { parse: [] } });
            return;
        }

        if (["roast", "compliment", "kill", "kiss"].includes(name)) {
            const description = createSocialResponse(name, {
                author: author.id,
                target: target.id,
                authorName: getDisplayName(author, message.guild),
                targetName: getDisplayName(target, message.guild)
            }).description;
            await message.reply({ embeds: [createEmbed(
                `${name === "roast" ? "🔥" : name === "compliment" ? "💖" : name === "kill" ? "🎬" : "💌"} ${SOCIAL_TITLES[name]}`,
                SOCIAL_COLORS[name],
                target,
                description
            )], allowedMentions: { parse: [] } });
        }
    } catch (error) {
        const embed = createErrorEmbed(error);
        await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
}

const OPTIONAL_USER_COMMANDS = ["dnatest", "gaytest", "iqtest", "rizztest", "lucktest", "chatest", "charoll"];
const SOCIAL_COMMANDS = ["roast", "compliment", "kill", "kiss"];

function createCommand(name) {
    if (name === "characters") {
        return {
            data: new SlashCommandBuilder()
                .setName("characters")
                .setDescription("List the character catalogue by name and source.")
                .addIntegerOption(option => option
                    .setName("page")
                    .setDescription("Catalogue page")
                    .setMinValue(1)),
            execute: executeCharacters
        };
    }
    if (!FUN_COMMAND_NAMES.includes(name)) throw new TypeError(`Unknown fun command: ${name}`);
    const builder = new SlashCommandBuilder().setName(name).setDescription(
        name === "dnatest" ? "View a fictional, saved meme DNA profile." :
            name === "iqtest" ? "Get a permanent fictional IQ-style entertainment score." :
                name === "lovetest" ? "Get the saved compatibility score for two users." :
                    name === "chatest" ? "View a user's daily character assignment." :
                        name === "charoll" ? "Reroll a character when your global cooldown allows." :
                            SOCIAL_COMMANDS.includes(name) ? `Send a playful ${name} response.` :
                                `View a user's permanent ${name.replace("test", "")} score.`
    );
    if (OPTIONAL_USER_COMMANDS.includes(name)) {
        builder.addUserOption(option => option.setName("user").setDescription("User to check"));
    } else if (name === "lovetest") {
        builder
            .addUserOption(option => option.setName("user1").setDescription("First user").setRequired(true))
            .addUserOption(option => option.setName("user2").setDescription("Second user").setRequired(true));
    } else if (SOCIAL_COMMANDS.includes(name)) {
        builder.addUserOption(option => option.setName("user").setDescription("User to interact with").setRequired(true));
    }
    return {
        data: builder,
        execute: interaction => executeSlash(name, interaction)
    };
}

async function executeCharacters(interaction) {
    try {
        const characters = getCharacterCatalogue();
        const pageSize = 20;
        const page = interaction.options.getInteger("page") || 1;
        const pageCount = Math.ceil(characters.length / pageSize);
        if (page > pageCount) {
            throw new UserFacingError(`The character catalogue has ${pageCount} page(s).`);
        }
        const lines = characters
            .slice((page - 1) * pageSize, page * pageSize)
            .map(character => `**${character.name}** — ${character.source}`);
        await interaction.reply({
            embeds: [createEconomyEmbed({
                title: `MARK Characters · page ${page}/${pageCount}`,
                description: lines.join("\n"),
                color: 0x9B59B6,
                footer: "Names and sources only"
            })],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        await makeResponse(interaction, createErrorEmbed(error), true);
    }
}

function createCommands() {
    return [...FUN_COMMAND_NAMES, "characters"].map(createCommand);
}

module.exports = {
    FUN_COMMAND_NAMES,
    createCommand,
    createCommands,
    executeCharacters,
    executeSlash,
    executePrefix,
    initializeFunStorage,
    getDnaProfile,
    resolveDnaTraits,
    percentageBar,
    getDnaDescription,
    createErrorEmbed,
    resolvePrefixUser
};
