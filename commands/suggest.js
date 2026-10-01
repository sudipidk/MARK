const { SlashCommandBuilder } = require("discord.js");
const {
    readGuildData,
    createSuggestion,
    discardSuggestion,
    attachSuggestionMessage,
    renderSuggestionEmbed,
    renderSuggestionComponents
} = require("../services/suggestions");
const { UserFacingError } = require("../services/errors");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("suggest")
        .setDescription("Submit a suggestion for this server.")
        .addStringOption(option => option
            .setName("idea")
            .setDescription("Describe your suggestion.")
            .setMinLength(5)
            .setMaxLength(1500)
            .setRequired(true)),

    async execute(interaction) {
        const config = readGuildData(interaction.guildId);
        if (!config.enabled || !config.channelId) {
            throw new UserFacingError("Suggestions are not currently enabled in this server.");
        }

        const channel = await interaction.guild.channels.fetch(config.channelId);
        if (!channel || !channel.isTextBased() || !channel.isSendable()) {
            throw new UserFacingError("The configured suggestion channel is unavailable. Ask a server manager to configure it again.");
        }

        const suggestion = createSuggestion(
            interaction.guildId,
            interaction.user.id,
            interaction.options.getString("idea", true).trim()
        );
        let postedMessage;
        try {
            postedMessage = await channel.send({
                embeds: [renderSuggestionEmbed(suggestion)],
                components: renderSuggestionComponents(suggestion)
            });
            attachSuggestionMessage(interaction.guildId, suggestion.id, channel.id, postedMessage.id);
        } catch (error) {
            discardSuggestion(interaction.guildId, suggestion.id);
            if (postedMessage) {
                try {
                    await postedMessage.delete();
                } catch (deleteError) {
                    console.error("Failed to remove an untracked suggestion message:", {
                        suggestionId: suggestion.id,
                        code: deleteError.code || deleteError.name
                    });
                }
            }
            throw error;
        }

        await interaction.reply({
            content: `Your suggestion **#${suggestion.id}** was submitted in ${channel}.`,
            ephemeral: true
        });
    }
};
