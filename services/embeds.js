const { EmbedBuilder } = require("discord.js");

const COLORS = {
    info: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245
};

function createEmbed(title, color = COLORS.info) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setTimestamp();
}

module.exports = {
    COLORS,
    createEmbed
};
