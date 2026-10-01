const { PermissionFlagsBits } = require("discord.js");
const { createEmbed, COLORS } = require("./embeds");
const { UserFacingError } = require("./errors");
const { formatDuration } = require("./duration");
const { tryLogModerationAction } = require("./moderation-logs");

function assertPermission(interaction, permission) {
    if (!interaction.memberPermissions?.has(permission)) {
        throw new UserFacingError("You do not have permission to use this moderation command.");
    }
}

async function fetchMemberOrNull(guild, userId) {
    try {
        return await guild.members.fetch(userId);
    } catch (error) {
        if (error.code === 10007) return null;
        throw error;
    }
}

async function assertCanModerate(interaction, user, targetMember) {
    if (user.id === interaction.guild.ownerId) {
        throw new UserFacingError("The server owner cannot be moderated.");
    }
    if (user.id === interaction.client.user.id) {
        throw new UserFacingError("MARK cannot moderate itself.");
    }
    if (user.id === interaction.user.id) {
        throw new UserFacingError("You cannot moderate yourself.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const bot = interaction.guild.members.me ||
        await interaction.guild.members.fetch(interaction.client.user.id);

    if (!targetMember) {
        return;
    }

    if (actor.id !== interaction.guild.ownerId &&
        targetMember.roles.highest.comparePositionTo(actor.roles.highest) >= 0) {
        throw new UserFacingError("You cannot moderate a member with an equal or higher role.");
    }
    if (targetMember.roles.highest.comparePositionTo(bot.roles.highest) >= 0) {
        throw new UserFacingError("MARK cannot moderate that member because of role hierarchy.");
    }
}

function buildResultEmbed(action, user, moderator, reason, duration) {
    const embed = createEmbed(`Moderation: ${action}`, COLORS.success)
        .addFields(
            { name: "Target", value: `${user} (${user.id})`, inline: true },
            { name: "Moderator", value: `${moderator}`, inline: true },
            { name: "Reason", value: reason || "No reason provided" }
        );
    if (duration) embed.addFields({ name: "Duration", value: duration, inline: true });
    return embed;
}

async function executeModeration(interaction, {
    action,
    user,
    reason,
    durationMs
}) {
    const permissions = {
        kick: PermissionFlagsBits.KickMembers,
        ban: PermissionFlagsBits.BanMembers,
        unban: PermissionFlagsBits.BanMembers,
        timeout: PermissionFlagsBits.ModerateMembers,
        untimeout: PermissionFlagsBits.ModerateMembers
    };
    assertPermission(interaction, permissions[action]);

    if (action === "unban" && typeof user === "string") {
        try {
            const ban = await interaction.guild.bans.fetch(user);
            user = ban.user;
        } catch (error) {
            if (error.code === 10026) {
                throw new UserFacingError("That user is not currently banned.");
            }
            throw error;
        }
    }

    const member = await fetchMemberOrNull(interaction.guild, user.id);
    if ((action === "kick" || action === "timeout" || action === "untimeout") && !member) {
        throw new UserFacingError("That user must be a current server member for this action.");
    }
    await assertCanModerate(interaction, user, member);

    const safeReason = (reason || "No reason provided").slice(0, 500);
    switch (action) {
        case "kick":
            await member.kick(safeReason);
            break;
        case "ban": {
            try {
                await interaction.guild.bans.fetch(user.id);
                throw new UserFacingError("That user is already banned.");
            } catch (error) {
                if (error instanceof UserFacingError) throw error;
                if (error.code !== 10026) throw error;
            }
            await interaction.guild.members.ban(user.id, { reason: safeReason });
            break;
        }
        case "unban":
            try {
                await interaction.guild.bans.fetch(user.id);
            } catch (error) {
                if (error.code === 10026) {
                    throw new UserFacingError("That user is not currently banned.");
                }
                throw error;
            }
            await interaction.guild.bans.remove(user.id, safeReason);
            break;
        case "timeout":
            await member.timeout(durationMs, safeReason);
            break;
        case "untimeout":
            if (!member.communicationDisabledUntilTimestamp ||
                member.communicationDisabledUntilTimestamp <= Date.now()) {
                throw new UserFacingError("That member is not currently timed out.");
            }
            await member.timeout(null, safeReason);
            break;
        default:
            throw new Error(`Unknown moderation action: ${action}`);
    }

    const duration = durationMs ? formatDuration(durationMs) : null;
    const targetLabel = `${user.tag || user.username} (${user.id})`;
    await tryLogModerationAction(interaction.guild, {
        action,
        targetId: user.id,
        targetLabel,
        moderator: interaction.user,
        reason: safeReason,
        duration
    });

    return buildResultEmbed(action, user, interaction.user, safeReason, duration);
}

module.exports = {
    executeModeration
};
