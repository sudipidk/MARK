const { SlashCommandBuilder } = require("discord.js");
const { getServerData } = require("../services/counting");

function topEntry(records) {
    return Object.entries(records)
        .sort((left, right) => right[1] - left[1])[0];
}

async function getUsername(interaction, userId) {
    const cachedUser = interaction.client.users.cache.get(userId);
    const user = cachedUser || await interaction.client.users.fetch(userId);
    return user.username;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-stats")
        .setDescription("Show this server's counting statistics."),

    async execute(interaction) {
        const data = getServerData(interaction.guildId);
        const validCounts = Object.values(data.countsByUser)
            .reduce((total, count) => total + count, 0);
        const deletedMessages = Object.values(data.deletedByUser)
            .reduce((total, count) => total + count, 0);
        const topCounter = topEntry(data.countsByUser);
        const mostDeleted = topEntry(data.deletedByUser);
        const [topCounterUsername, mostDeletedUsername] = await Promise.all([
            topCounter ? getUsername(interaction, topCounter[0]) : null,
            mostDeleted ? getUsername(interaction, mostDeleted[0]) : null
        ]);

        await interaction.reply({
            content: [
                "**Counting statistics**",
                `Current count: **${data.currentCount}**`,
                `Highest count: **${data.highestCount}**`,
                `Total valid counts: **${validCounts}**`,
                `Total messages deleted: **${deletedMessages}**`,
                `Top counter: ${topCounter ? `${topCounterUsername} (${topCounter[1]} counts)` : "None yet"}`,
                `Most messages deleted: ${mostDeleted ? `${mostDeletedUsername} (${mostDeleted[1]} messages)` : "None yet"}`,
                `Counting channel: ${data.channelId ? `<#${data.channelId}>` : "Not configured"}`,
                `Math: **${data.mathEnabled ? "on" : "off"}** | Cheat mode: **${data.cheatEnabled ? "on" : "off"}**`,
                `Streak protection: **${data.streakEnabled ? "on" : "off"}** | Talk: **${data.talkEnabled ? "on" : "off"}**`,
                `Violation timeout: **${data.punishmentMinutes ? `${data.punishmentMinutes} minutes` : "off"}**`
            ].join("\n"),
            allowedMentions: { parse: [] }
        });
    }
};
