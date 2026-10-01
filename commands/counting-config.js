const { SlashCommandBuilder } = require("discord.js");
const { getServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-config")
        .setDescription("Show this server's counting configuration."),

    async execute(interaction) {
        const data = getServerData(interaction.guildId);

        await interaction.reply({
            content: [
                "**Counting configuration**",
                `Channel: ${data.channelId ? `<#${data.channelId}>` : "Disabled (not configured)"}`,
                `Math: **${data.mathEnabled ? "ON" : "OFF"}**`,
                `Cheat protection: **${data.cheatEnabled ? "ON" : "OFF"}**`,
                `Streak protection: **${data.streakEnabled ? "ON" : "OFF"}**`,
                `Talking: **${data.talkEnabled ? "ON" : "OFF"}**`,
                `Punishment: **${data.punishmentMinutes} minutes**`
            ].join("\n")
        });
    }
};
