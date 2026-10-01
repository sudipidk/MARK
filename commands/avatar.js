const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder
} = require("discord.js");
const { createEmbed } = require("../services/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("avatar")
        .setDescription("Show a user's avatar.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The user whose avatar to show; defaults to you.")),

    async execute(interaction) {
        const user = interaction.options.getUser("user") || interaction.user;
        const imageUrl = user.displayAvatarURL({ size: 4096 });
        const embed = createEmbed(`${user.username}'s avatar`)
            .setImage(imageUrl)
            .setFooter({ text: `User ID: ${user.id}` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Open full-size avatar")
                .setURL(imageUrl)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
