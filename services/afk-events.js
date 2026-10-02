const { EmbedBuilder } = require("discord.js");
const { formatDuration } = require("./duration");
const { clearAfk, getAfk, incrementAfkPing } = require("./afk");

function formatAfkDuration(startedAt, now = Date.now()) {
    return formatDuration(Math.max(0, now - new Date(startedAt).getTime()));
}

async function findReplyAuthor(message) {
    if (message.mentions.repliedUser) return message.mentions.repliedUser;
    if (!message.reference || !message.reference.messageId) return null;

    try {
        const referenced = await message.fetchReference();
        return referenced.author;
    } catch (error) {
        if (error.code !== 10008 && error.code !== 50001 && error.code !== 50013) {
            console.error("Failed to inspect a replied-to message for AFK status:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }
        return null;
    }
}

async function notifyAfkTargets(message) {
    const targets = new Map();
    for (const [userId, user] of message.mentions.users) {
        if (userId !== message.author.id) targets.set(userId, user);
    }

    const replyAuthor = await findReplyAuthor(message);
    if (replyAuthor && replyAuthor.id !== message.author.id) {
        targets.set(replyAuthor.id, replyAuthor);
    }

    const fields = [];
    for (const [userId, user] of targets) {
        const record = await getAfk(message.guildId, userId);
        if (!record) continue;
        const updated = await incrementAfkPing(message.guildId, userId);
        if (!updated) continue;
        fields.push({
            name: user.username || user.globalName || user.tag || "AFK user",
            value: [
                `Reason: ${updated.reason}`,
                `AFK for: ${formatAfkDuration(updated.startedAt)}`,
                `Pings received: ${updated.pingCount}`
            ].join("\n")
        });
    }

    if (fields.length === 0) return;
    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle("💤 AFK Notice")
        .setDescription("These members are currently AFK.")
        .addFields(fields.slice(0, 25));

    await message.reply({
        embeds: [embed],
        allowedMentions: { parse: [] }
    });
}

async function welcomeBack(message) {
    const record = await clearAfk(message.guildId, message.author.id);
    if (!record) return;

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle("👋 Welcome Back")
        .setDescription(`<@${message.author.id}> is no longer AFK.`)
        .addFields(
            { name: "AFK Duration", value: formatAfkDuration(record.startedAt), inline: true },
            { name: "Pings Received", value: String(record.pingCount || 0), inline: true },
            { name: "Reason", value: record.reason }
        );

    await message.reply({
        embeds: [embed],
        allowedMentions: { parse: [] }
    });
}

module.exports = {
    notifyAfkTargets,
    welcomeBack,
    formatAfkDuration
};
