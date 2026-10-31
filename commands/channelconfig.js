const {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");
const { createEmbed, COLORS } = require("../services/embeds");
const { UserFacingError } = require("../services/errors");
const { formatDuration, MAX_TIMEOUT_MS, parseDuration } = require("../services/duration");
const {
    getChannelConfig,
    resetChannelConfig,
    updateChannelConfig
} = require("../services/channel-config");

const CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread
];
const CONTENT_OPTIONS = {
    gif: "GIF",
    emoji: "Emoji",
    media: "Media",
    sticker: "Sticker",
    text: "Normal text"
};
const CONFIG_PERMISSION = PermissionFlagsBits.ManageChannels |
    PermissionFlagsBits.Administrator;

function addChannelOption(subcommand, name, description) {
    return subcommand
        .setName(name)
        .setDescription(description)
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("The server channel to configure.")
            .addChannelTypes(...CHANNEL_TYPES)
            .setRequired(true));
}

function requireGuildAndPermission(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
        throw new UserFacingError("Channel Control commands can only be used in a server.");
    }
    const permissions = interaction.memberPermissions;
    if (!permissions?.has(PermissionFlagsBits.ManageChannels) &&
        !permissions?.has(PermissionFlagsBits.Administrator)) {
        throw new UserFacingError("You need Manage Channels or Administrator permission to configure Channel Control.");
    }
}

function formatStatus(value) {
    return value ? "Enabled" : "Disabled";
}

function configEmbed(channel, config) {
    const embed = createEmbed(`Channel Control — #${channel.name}`)
        .setDescription(`Channel: <#${channel.id}> (\`${channel.id}\`)\nSystem: **${formatStatus(config.enabled)}**`)
        .addFields(
            {
                name: "Content Permissions",
                value: [
                    `GIFs: **${formatStatus(config.allowed.gif)}**`,
                    `Emojis: **${formatStatus(config.allowed.emoji)}**`,
                    `Media: **${formatStatus(config.allowed.media)}**`,
                    `Stickers: **${formatStatus(config.allowed.sticker)}**`,
                    `Normal Text: **${formatStatus(config.allowed.text)}**`
                ].join("\n")
            },
            {
                name: "Moderation",
                value: [
                    `Automatic Deletion: **${formatStatus(config.moderation.deleteMessages)}**`,
                    `Timeout: **${formatStatus(config.moderation.timeout.enabled)}**`,
                    `Duration: **${formatDuration(config.moderation.timeout.duration)}**`,
                    `Violation Threshold: **${config.moderation.timeout.threshold}**`
                ].join("\n")
            },
            {
                name: "Exemptions",
                value: [
                    `Roles: ${config.exceptions.roles.length
                        ? config.exceptions.roles.map(id => `<@&${id}>`).join(", ")
                        : "None"}`,
                    `Users: ${config.exceptions.users.length
                        ? config.exceptions.users.map(id => `<@${id}>`).join(", ")
                        : "None"}`
                ].join("\n")
            }
        );
    return embed;
}

async function updateSetting(interaction, channel, changes, label, previous, next) {
    await updateChannelConfig(
        interaction.guildId,
        channel.id,
        changes,
        interaction.user.id
    );
    const embed = createEmbed("Channel Configuration Updated", COLORS.success)
        .setDescription(`${label} has been updated for <#${channel.id}>.`)
        .addFields(
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Previous value", value: previous, inline: true },
            { name: "New value", value: next, inline: true },
            { name: "Administrator", value: `${interaction.user}`, inline: true }
        );
    await interaction.editReply({ embeds: [embed] });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("channelconfig")
        .setDescription("Configure content restrictions and moderation for a channel.")
        .setDefaultMemberPermissions(CONFIG_PERMISSION)
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "gif",
            "Allow or block GIFs in a channel."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether GIFs are allowed.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "emoji",
            "Allow or block emojis in a channel."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether emojis are allowed.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "media",
            "Allow or block images and videos in a channel."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether images and videos are allowed.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "sticker",
            "Allow or block stickers in a channel."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether stickers are allowed.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "text",
            "Allow or block normal text in a channel."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether normal text is allowed.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "all",
            "Allow all supported content categories."
        ))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "delete",
            "Configure automatic deletion of violating messages."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether violating messages are deleted.")
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "timeout",
            "Configure timeouts for repeated violations."
        ).addBooleanOption(option => option
                .setName("enabled")
                .setDescription("Whether repeated violations trigger a timeout.")
                .setRequired(true))
            .addStringOption(option => option
                .setName("duration")
                .setDescription("Timeout duration (30s, 5m, 1h, 1d; maximum 28d).")
                .setMaxLength(20)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "threshold",
            "Set violations required before a timeout."
        ).addIntegerOption(option => option
                .setName("violations")
                .setDescription("Number of violations required (1-1000).")
                .setMinValue(1)
                .setMaxValue(1000)
                .setRequired(true)))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "view",
            "View the complete channel configuration."
        ))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "disable",
            "Temporarily disable Channel Control in a channel."
        ))
        .addSubcommand(subcommand => addChannelOption(
            subcommand,
            "reset",
            "Delete the channel configuration and its violation records."
        )),

    async execute(interaction) {
        requireGuildAndPermission(interaction);
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel("channel", true);
        if (!channel.isTextBased() || !channel.guild ||
            channel.guildId !== interaction.guildId) {
            throw new UserFacingError("Choose a text channel in this server.");
        }

        const config = await getChannelConfig(interaction.guildId, channel.id);
        if (subcommand === "view") {
            if (!config) {
                const embed = createEmbed(`Channel Control — #${channel.name}`)
                    .setDescription(`Restrictions are not configured for <#${channel.id}>. The channel is unrestricted.`);
                await interaction.editReply({ embeds: [embed] });
                return;
            }
            await interaction.editReply({ embeds: [configEmbed(channel, config)] });
            return;
        }

        if (subcommand === "reset") {
            await resetChannelConfig(interaction.guildId, channel.id);
            const embed = createEmbed("Channel Configuration Reset", COLORS.warning)
                .setDescription(`The saved configuration and violation records for <#${channel.id}> were deleted. The channel is now unrestricted.`);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === "all") {
            const changes = {
                enabled: true,
                "allowed.gif": true,
                "allowed.emoji": true,
                "allowed.media": true,
                "allowed.sticker": true,
                "allowed.text": true
            };
            const previous = config
                ? Object.values(config.allowed).every(Boolean) && config.enabled
                    ? "All enabled"
                    : "One or more disabled"
                : "Unconfigured";
            await updateSetting(interaction, channel, changes, "All content permissions", previous, "All enabled");
            return;
        }

        if (Object.hasOwn(CONTENT_OPTIONS, subcommand)) {
            const enabled = interaction.options.getBoolean("enabled", true);
            const label = CONTENT_OPTIONS[subcommand];
            const previous = config ? formatStatus(config.allowed[subcommand]) : "Enabled (default)";
            await updateSetting(
                interaction,
                channel,
                { [`enabled`]: true, [`allowed.${subcommand}`]: enabled },
                `${label} permission`,
                previous,
                formatStatus(enabled)
            );
            return;
        }

        if (subcommand === "delete") {
            const enabled = interaction.options.getBoolean("enabled", true);
            await updateSetting(
                interaction,
                channel,
                { "moderation.deleteMessages": enabled },
                "Automatic deletion",
                config ? formatStatus(config.moderation.deleteMessages) : "Enabled (default)",
                formatStatus(enabled)
            );
            return;
        }

        if (subcommand === "timeout") {
            const enabled = interaction.options.getBoolean("enabled", true);
            const rawDuration = interaction.options.getString("duration");
            let duration;
            if (rawDuration !== null) {
                duration = parseDuration(rawDuration);
                if (!duration || duration > MAX_TIMEOUT_MS) {
                    throw new UserFacingError("Invalid timeout duration. Use a value such as 30s, 5m, 1h, or 1d (maximum 28d).");
                }
            }
            const changes = { "moderation.timeout.enabled": enabled };
            if (duration !== undefined) changes["moderation.timeout.duration"] = duration;
            await updateSetting(
                interaction,
                channel,
                changes,
                "Timeout moderation",
                config ? formatStatus(config.moderation.timeout.enabled) : "Disabled (default)",
                `${formatStatus(enabled)}${duration ? ` (${formatDuration(duration)})` : ""}`
            );
            return;
        }

        if (subcommand === "threshold") {
            const threshold = interaction.options.getInteger("violations", true);
            if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
                throw new UserFacingError("The violation threshold must be a whole number between 1 and 1000.");
            }
            await updateSetting(
                interaction,
                channel,
                { "moderation.timeout.threshold": threshold },
                "Violation threshold",
                String(config?.moderation.timeout.threshold ?? 3),
                String(threshold)
            );
            return;
        }

        if (subcommand === "disable") {
            await updateSetting(
                interaction,
                channel,
                { enabled: false },
                "Channel Control",
                config ? formatStatus(config.enabled) : "Enabled (default)",
                "Disabled"
            );
            return;
        }

        throw new UserFacingError("Unknown Channel Control subcommand.");
    }
};
