const { SlashCommandBuilder } = require("discord.js");
const { getServerData } = require("../services/counting");

function topEntry(records) {
    return Object.entries(records)
        .sort((left, right) => right[1] - left[1])[0];
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

        await interaction.reply({
            content: [
                "**Counting statistics**",
                `Current count: **${data.currentCount}**`,
                `Highest count: **${data.highestCount}**`,
                `Total valid counts: **${validCounts}**`,
                `Total messages deleted: **${deletedMessages}**`,
                `Top counter: ${topCounter ? `<@${topCounter[0]}> (${topCounter[1]} counts)` : "None yet"}`,
                `Most messages deleted: ${mostDeleted ? `<@${mostDeleted[0]}> (${mostDeleted[1]} messages)` : "None yet"}`,
                `Counting channel: ${data.channelId ? `<#${data.channelId}>` : "Not configured"}`,
                `Math: **${data.mathEnabled ? "on" : "off"}** | Cheat mode: **${data.cheatEnabled ? "on" : "off"}**`,
                `Streak protection: **${data.streakEnabled ? "on" : "off"}** | Talk: **${data.talkEnabled ? "on" : "off"}**`,
                `Violation timeout: **${data.punishmentMinutes ? `${data.punishmentMinutes} minutes` : "off"}**`
            ].join("\n")
        });
    }
};
