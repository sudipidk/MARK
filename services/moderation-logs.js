const { createEmbed, COLORS } = require("./embeds");
const { getGuildSettings } = require("./guild-settings");

async function logModerationAction(guild, action) {
    const settings = getGuildSettings(guild.id);
    if (!settings.moderationLogChannelId) return;

    const channel = await guild.channels.fetch(settings.moderationLogChannelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
        throw new Error("Configured moderation log channel is not a sendable text channel.");
    }

    const embed = createEmbed(`Moderation: ${action.action}`, COLORS.warning)
        .addFields(
            { name: "Target", value: action.targetLabel, inline: true },
            { name: "Moderator", value: `${action.moderator} (${action.moderator.id})`, inline: true },
            { name: "Reason", value: action.reason || "No reason provided" }
        );

    if (action.duration) {
        embed.addFields({ name: "Duration", value: action.duration, inline: true });
    }

    if (action.targetId) {
        embed.addFields({ name: "Target ID", value: action.targetId, inline: true });
    }

    await channel.send({ embeds: [embed] });
}

async function tryLogModerationAction(guild, action) {
    try {
        await logModerationAction(guild, action);
    } catch (error) {
        console.error("Failed to post moderation log:", {
            action: action.action,
            code: error.code || error.name
        });
        return false;
    }
    return true;
}

module.exports = {
    tryLogModerationAction
};
