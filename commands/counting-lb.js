const { SlashCommandBuilder } = require("discord.js");
const { getServerData } = require("../services/counting");

async function getUsername(interaction, userId) {
    const cachedUser = interaction.client.users.cache.get(userId);
    const user = cachedUser || await interaction.client.users.fetch(userId);
    return user.username;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-lb")
        .setDescription("Show the five members with the most valid counts."),

    async execute(interaction) {
        const leaders = Object.entries(getServerData(interaction.guildId).countsByUser)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5);

        const rows = leaders.length
            ? await Promise.all(leaders.map(async ([userId, count], index) =>
                `${index + 1}. ${await getUsername(interaction, userId)} — **${count}** valid counts`))
            : ["No valid counts have been recorded yet."];

        await interaction.reply({
            content: `**Counting leaderboard**\n${rows.join("\n")}`,
            allowedMentions: { parse: [] }
        });
    }
};
