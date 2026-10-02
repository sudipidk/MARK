const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { setAfk } = require("../services/afk");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("afk")
        .setDescription("Set your AFK status in this server.")
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why you are AFK.")
            .setMaxLength(500)
            .setRequired(false)),

    async execute(interaction) {
        const record = await setAfk(
            interaction.guildId,
            interaction.user.id,
            interaction.options.getString("reason") || ""
        );
        const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle("💤 AFK Enabled")
            .setDescription(`${interaction.user} is now AFK.\n\nReason: ${record.reason}`);
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
};
