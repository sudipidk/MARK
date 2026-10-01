const { SlashCommandBuilder } = require("discord.js");
const { createEmbed } = require("../services/embeds");

function formatUptime(totalSeconds) {
    let remaining = totalSeconds;
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(" ");
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("uptime")
        .setDescription("Show MARK's process uptime and gateway latency."),

    async execute(interaction) {
        const uptimeSeconds = Math.floor(process.uptime());
        const embed = createEmbed("MARK uptime")
            .addFields(
                { name: "Process uptime", value: formatUptime(uptimeSeconds), inline: true },
                { name: "Gateway latency", value: `${interaction.client.ws.ping}ms`, inline: true }
            );
        await interaction.reply({ embeds: [embed] });
    }
};
