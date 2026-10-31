const { PermissionFlagsBits } = require("discord.js");
const { analyzeMessage } = require("./channel-message-analyzer");
const {
    getChannelConfig,
    recordChannelViolation,
    claimChannelTimeout
} = require("./channel-config");

function isExempt(config, member) {
    if (config.exceptions.users.includes(member.id)) return true;
    return member.roles.cache.some(role => config.exceptions.roles.includes(role.id));
}

function hasViolation(config, categories) {
    for (const category of ["gif", "emoji", "media", "sticker", "text"]) {
        if (categories[category] && !config.allowed[category]) return true;
    }
    return categories.unknown &&
        Object.values(config.allowed).some(enabled => !enabled);
}

function logEnforcementError(action, message, error) {
    console.error(`Channel Control could not ${action}:`, {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
        code: error.code || error.name
    });
}

async function applyTimeout(message, config) {
    if (!config.moderation.timeout.enabled) return;

    const member = message.member;
    const botMember = message.guild.members.me;
    if (!member || !botMember ||
        member.id === message.guild.ownerId ||
        member.id === message.client.user.id ||
        !member.moderatable ||
        !botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        console.warn("Channel Control could not timeout a member:", {
            guildId: message.guildId,
            channelId: message.channelId,
            userId: message.author.id,
            reason: !member || !botMember ? "member unavailable" :
                member.id === message.guild.ownerId ? "server owner" :
                    member.id === message.client.user.id ? "bot member" :
                        !member.moderatable ? "role hierarchy or permissions" :
                            "missing Moderate Members permission"
        });
        return;
    }

    const timeoutClaim = await claimChannelTimeout(
        message.guildId,
        message.channelId,
        member.id,
        config.moderation.timeout.threshold
    );
    if (!timeoutClaim) return;

    try {
        await member.timeout(
            config.moderation.timeout.duration,
            `Channel Control: ${timeoutClaim.violations} violations in <#${message.channelId}>`
        );
    } catch (error) {
        logEnforcementError("apply a timeout", message, error);
    }
}

async function enforceChannelMessage(message) {
    if (!message.guild || message.author.bot || message.webhookId || !message.member) return;

    const config = await getChannelConfig(message.guildId, message.channelId);
    if (!config?.enabled || isExempt(config, message.member)) return;

    const categories = analyzeMessage(message);
    if (!hasViolation(config, categories)) return;

    if (config.moderation.deleteMessages) {
        try {
            await message.delete();
        } catch (error) {
            logEnforcementError("delete a violating message", message, error);
        }
    }

    try {
        const violation = await recordChannelViolation(
            message.guildId,
            message.channelId,
            message.author.id,
            config.moderation.timeout.resetAfter
        );
        if (violation?.violations >= config.moderation.timeout.threshold) {
            await applyTimeout(message, config);
        }
    } catch (error) {
        logEnforcementError("record a violation", message, error);
    }
}

function registerChannelControlEvents(client) {
    client.on("messageCreate", message => {
        enforceChannelMessage(message).catch(error => {
            logEnforcementError("process a message", message, error);
        });
    });
}

module.exports = {
    enforceChannelMessage,
    registerChannelControlEvents,
    hasViolation,
    isExempt
};
