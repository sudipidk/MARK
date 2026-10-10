const { EmbedBuilder } = require("discord.js");

const COLORS = Object.freeze({
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245
});

function truncate(value, maximum) {
    const text = value == null ? "" : String(value);
    return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function createEconomyEmbed({
    title = "MARK Economy",
    description,
    fields = [],
    color = COLORS.primary,
    author,
    avatarURL,
    footer
}) {
    const embed = new EmbedBuilder().setColor(color);
    let remaining = 6000;
    const safeTitle = title ? truncate(title, Math.min(256, remaining)) : "";
    if (safeTitle) {
        embed.setTitle(safeTitle);
        remaining -= safeTitle.length;
    }
    const safeDescription = description
        ? truncate(description, Math.min(4096, remaining))
        : "";
    if (safeDescription) {
        embed.setDescription(safeDescription);
        remaining -= safeDescription.length;
    }
    if (author) {
        const safeAuthor = truncate(author, Math.min(256, remaining));
        embed.setAuthor({
            name: safeAuthor,
            ...(avatarURL ? { iconURL: avatarURL } : {})
        });
        remaining -= safeAuthor.length;
    }
    const safeFields = [];
    for (const field of fields.slice(0, 25)) {
        if (remaining < 4) break;
        const name = truncate(field.name || "\u200b", Math.min(256, remaining - 2));
        const value = truncate(field.value || "\u200b", Math.min(1024, remaining - name.length));
        if (!name || !value) break;
        safeFields.push({ name, value, inline: Boolean(field.inline) });
        remaining -= name.length + value.length;
    }
    if (safeFields.length) embed.addFields(safeFields);
    if (footer && remaining > 0) {
        const safeFooter = truncate(footer, Math.min(2048, remaining));
        if (safeFooter) embed.setFooter({ text: safeFooter });
    }
    return embed;
}

function economyReply(title, description, options = {}) {
    return {
        embeds: [createEconomyEmbed({ title, description, ...options })],
        allowedMentions: { parse: [] }
    };
}

module.exports = { COLORS, createEconomyEmbed, economyReply, truncate };
