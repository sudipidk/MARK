const {
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");
const { getDB } = require("../db");
const { UserFacingError } = require("./errors");

const SETTINGS_COLLECTION = "hallSettings";
const POSTS_COLLECTION = "hallPosts";
const HALL_NAMES = Object.freeze({ hof: "Hall of Fame", hos: "Hall of Shame" });
const MAX_REACTION_COUNT = 10_000;

function parseEmoji(value) {
    const input = String(value || "").trim();
    const custom = input.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    if (custom) {
        return {
            key: custom[3],
            display: input
        };
    }

    if (typeof Intl.Segmenter !== "function" ||
        [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(input)].length !== 1) {
        throw new UserFacingError("Enter one Unicode emoji or a custom server emoji.");
    }
    return { key: input, display: input };
}

function hallCollections() {
    const database = getDB();
    return {
        settings: database.collection(SETTINGS_COLLECTION),
        posts: database.collection(POSTS_COLLECTION)
    };
}

async function initializeHallStorage() {
    const { settings, posts } = hallCollections();
    await Promise.all([
        settings.createIndex({ guildId: 1, hall: 1 }, { unique: true }),
        posts.createIndex({ guildId: 1, hall: 1, messageId: 1 }, { unique: true })
    ]);
}

function requireGuildAdmin(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
        throw new UserFacingError("Hall of Fame and Hall of Shame commands can only be used in a server.");
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new UserFacingError("You need Administrator or Manage Server permission to configure the halls.");
    }
}

async function updateHallSetting(guildId, hall, change) {
    const { settings } = hallCollections();
    try {
        await settings.updateOne(
            { guildId, hall },
            { $set: { ...change, guildId, hall, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
        await settings.updateOne(
            { guildId, hall },
            { $set: { ...change, updatedAt: new Date() } }
        );
    }
}

async function executeHallCommand(interaction, hall) {
    requireGuildAdmin(interaction);
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (subcommand === "setemoji") {
        const emoji = parseEmoji(interaction.options.getString("emoji", true));
        await updateHallSetting(interaction.guildId, hall, {
            emojiKey: emoji.key,
            emojiDisplay: emoji.display
        });
        await interaction.editReply(`${HALL_NAMES[hall]} will use ${emoji.display}.`);
        return;
    }

    if (subcommand === "setchannel") {
        const channel = interaction.options.getChannel("channel", true);
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
            channel.guildId !== interaction.guildId) {
            throw new UserFacingError("Choose a text or announcement channel in this server.");
        }
        await updateHallSetting(interaction.guildId, hall, { channelId: channel.id });
        await interaction.editReply(`${HALL_NAMES[hall]} messages will be sent to ${channel}.`);
        return;
    }

    if (subcommand === "setnum") {
        const num = interaction.options.getInteger("num", true);
        if (!Number.isInteger(num) || num < 1 || num > MAX_REACTION_COUNT) {
            throw new UserFacingError(`The reaction threshold must be between 1 and ${MAX_REACTION_COUNT}.`);
        }
        await updateHallSetting(interaction.guildId, hall, { reactionThreshold: num });
        await interaction.editReply(`${HALL_NAMES[hall]} requires ${num} reaction(s).`);
        return;
    }

    throw new UserFacingError("That Hall of Fame or Hall of Shame command is not supported.");
}

function imageUrlFromMessage(message) {
    const attachment = [...message.attachments.values()].find(item =>
        item.contentType?.startsWith("image/") ||
        /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(item.url)
    );
    if (attachment) return attachment.url;
    return message.embeds.find(embed => embed.image?.url)?.image.url || null;
}

function renderHallEmbed(message, hall) {
    const author = { name: message.author.username };
    const avatar = message.author.displayAvatarURL({ size: 256 });
    if (avatar) author.iconURL = avatar;
    const embed = new EmbedBuilder()
        .setColor(hall === "hof" ? 0xf1c40f : 0x992d22)
        .setTitle(`${HALL_NAMES[hall]} message`)
        .setAuthor(author)
        .setURL(message.url)
        .setTimestamp(message.createdAt);
    if (message.content) embed.setDescription(message.content);
    const imageUrl = imageUrlFromMessage(message);
    if (imageUrl) embed.setImage(imageUrl);
    return embed;
}

async function claimPost(posts, guildId, hall, messageId) {
    const now = new Date();
    try {
        const result = await posts.updateOne(
            {
                guildId,
                hall,
                messageId,
                $or: [
                    { status: { $exists: false } },
                    { status: { $ne: "sent" }, lockUntil: { $exists: false } },
                    { status: { $ne: "sent" }, lockUntil: { $lte: now } }
                ]
            },
            {
                $set: {
                    status: "sending",
                    lockUntil: new Date(now.getTime() + 60_000),
                    updatedAt: now
                },
                $setOnInsert: { guildId, hall, messageId, createdAt: now }
            },
            { upsert: true }
        );
        return result.upsertedCount === 1 || result.modifiedCount === 1;
    } catch (error) {
        if (error.code === 11000) return false;
        throw error;
    }
}

async function handleHallReaction(client, reaction) {
    const completeReaction = reaction.partial ? await reaction.fetch() : reaction;
    const source = completeReaction.message.partial
        ? await completeReaction.message.fetch()
        : completeReaction.message;
    if (!source.guildId || !source.author || source.author.bot || source.webhookId) return;

    const { settings, posts } = hallCollections();
    const matchingSettings = await settings.find({
        guildId: source.guildId,
        emojiKey: completeReaction.emoji.id || completeReaction.emoji.name
    }).toArray();
    for (const config of matchingSettings) {
        if (!config.channelId || !Number.isInteger(config.reactionThreshold) ||
            !Number.isInteger(completeReaction.count) ||
            completeReaction.count < config.reactionThreshold) {
            continue;
        }

        const target = await client.channels.fetch(config.channelId);
        if (!target || !target.isTextBased() || !target.guild ||
            target.guild.id !== source.guildId || typeof target.send !== "function") {
            throw new Error(`Configured ${HALL_NAMES[config.hall]} channel is unavailable.`);
        }
        if (!await claimPost(posts, source.guildId, config.hall, source.id)) continue;

        const emoji = config.emojiDisplay || completeReaction.emoji.toString();
        const content = `${source.author}'s message got *${completeReaction.count}* *${emoji}*.`;
        let posted;
        try {
            posted = await target.send({
                content,
                embeds: [renderHallEmbed(source, config.hall)],
                allowedMentions: { users: [source.author.id] }
            });
        } catch (error) {
            await posts.updateOne(
                { guildId: source.guildId, hall: config.hall, messageId: source.id, status: "sending" },
                { $set: { status: "pending", updatedAt: new Date() }, $unset: { lockUntil: "" } }
            );
            throw error;
        }
        await posts.updateOne(
            { guildId: source.guildId, hall: config.hall, messageId: source.id },
            { $set: { status: "sent", destinationMessageId: posted.id, sentAt: new Date() }, $unset: { lockUntil: "" } }
        );
    }
}

function registerHallEvents(client) {
    client.on("messageReactionAdd", (reaction) => {
        handleHallReaction(client, reaction).catch(error => {
            console.error("Hall reaction processing failed:", {
                messageId: reaction.message?.id,
                code: error.code || error.name
            });
        });
    });
}

module.exports = {
    MAX_REACTION_COUNT,
    parseEmoji,
    initializeHallStorage,
    executeHallCommand,
    renderHallEmbed,
    handleHallReaction,
    registerHallEvents
};
