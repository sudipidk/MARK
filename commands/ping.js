const {
    SlashCommandBuilder
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check if Mark is online."),

    async execute(interaction) {
        await interaction.reply(
            `🏓 Pong!\nBot Latency: ${interaction.client.ws.ping}ms`
        );
    }
};