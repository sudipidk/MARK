const { SlashCommandBuilder } = require("discord.js");
const { getServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-lb")
        .setDescription("Show the five members with the most valid counts."),

    async execute(interaction) {
        const leaders = Object.entries(getServerData(interaction.guildId).countsByUser)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5);

        const rows = leaders.length
            ? leaders.map(([userId, count], index) =>
                `${index + 1}. <@${userId}> — **${count}** valid counts`)
            : ["No valid counts have been recorded yet."];

        await interaction.reply({
            content: `**Counting leaderboard**\n${rows.join("\n")}`
        });
    }
};
