const {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");
const { createEmbed } = require("../services/embeds");
const {
    configureSuggestions,
    disableSuggestions,
    readGuildData,
    getSuggestion,
    listSuggestions,
    voteCounts,
    renderSuggestionEmbed,
    listPagePayload
} = require("../services/suggestions");
const { UserFacingError } = require("../services/errors");

function requireManageGuild(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new UserFacingError("You need Administrator or Manage Server permission to configure suggestions.");
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("suggestion")
        .setDescription("Configure and view this server's suggestions.")
        .addSubcommand(subcommand => subcommand
            .setName("setchannel")
            .setDescription("Set the channel where suggestions will be posted.")
            .addChannelOption(option => option
                .setName("channel")
                .setDescription("Suggestion channel.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("disable")
            .setDescription("Disable suggestion submissions in this server."))
        .addSubcommand(subcommand => subcommand
            .setName("config")
            .setDescription("Show the suggestion configuration."))
        .addSubcommand(subcommand => subcommand
            .setName("view")
            .setDescription("View a suggestion by its number.")
            .addIntegerOption(option => option
                .setName("id")
                .setDescription("The suggestion number.")
                .setMinValue(1)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("list")
            .setDescription("Show a paginated list of this server's suggestions."))
        .addSubcommand(subcommand => subcommand
            .setName("stats")
            .setDescription("Show suggestion totals and vote counts.")),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "setchannel") {
            requireManageGuild(interaction);
            const channel = interaction.options.getChannel("channel", true);
            configureSuggestions(interaction.guildId, channel.id);
            await interaction.reply({
                content: `Suggestions are enabled in ${channel}.`
            });
            return;
        }

        if (subcommand === "disable") {
            requireManageGuild(interaction);
            disableSuggestions(interaction.guildId);
            await interaction.reply({ content: "Suggestion submissions have been disabled." });
            return;
        }

        if (subcommand === "config") {
            requireManageGuild(interaction);
            const config = readGuildData(interaction.guildId);
            await interaction.reply({
                embeds: [createEmbed("Suggestion configuration")
                    .addFields(
                        { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
                        { name: "Channel", value: config.channelId ? `<#${config.channelId}>` : "Not configured", inline: true },
                        { name: "Next suggestion ID", value: String(config.nextId), inline: true }
                    )]
            });
            return;
        }

        if (subcommand === "view") {
            const suggestionId = interaction.options.getInteger("id", true);
            const suggestion = getSuggestion(interaction.guildId, suggestionId);
            if (!suggestion) throw new UserFacingError(`Suggestion #${suggestionId} was not found.`);
            await interaction.reply({ embeds: [renderSuggestionEmbed(suggestion)] });
            return;
        }

        if (subcommand === "list") {
            if (listSuggestions(interaction.guildId).length === 0) {
                await interaction.reply({
                    embeds: [createEmbed("Suggestions").setDescription("No suggestions have been submitted.")],
                    ephemeral: true
                });
                return;
            }
            await interaction.reply({
                ...listPagePayload(interaction.guildId, 0),
                ephemeral: true
            });
            return;
        }

        if (subcommand === "stats") {
            const suggestions = listSuggestions(interaction.guildId);
            const counts = suggestions.reduce((total, suggestion) => {
                total[suggestion.status] += 1;
                total.votes += Object.keys(suggestion.votes).length;
                return total;
            }, { pending: 0, approved: 0, denied: 0, votes: 0 });

            await interaction.reply({
                embeds: [createEmbed("Suggestion statistics")
                    .addFields(
                        { name: "Total suggestions", value: String(suggestions.length), inline: true },
                        { name: "Pending", value: String(counts.pending), inline: true },
                        { name: "Approved", value: String(counts.approved), inline: true },
                        { name: "Denied", value: String(counts.denied), inline: true },
                        { name: "Total votes", value: String(counts.votes), inline: true }
                    )]
            });
        }
    }
};
