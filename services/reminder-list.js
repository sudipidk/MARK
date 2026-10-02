const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");
const { randomUUID } = require("node:crypto");
const { formatDuration } = require("./duration");
const { UserFacingError } = require("./errors");

const PAGE_SIZE = 10;
const SESSION_LIFETIME_MS = 2 * 60 * 1000;
const sessions = new Map();

function renderPage(reminders, page, token) {
    const pageCount = Math.max(1, Math.ceil(reminders.length / PAGE_SIZE));
    const start = page * PAGE_SIZE;
    const selected = reminders.slice(start, start + PAGE_SIZE);
    const now = Date.now();
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("⏰ Your Active Reminders")
        .setDescription(reminders.length
            ? `Showing ${start + 1}-${start + selected.length} of ${reminders.length}.`
            : "You have no active reminders.")
        .setFooter({ text: `Page ${page + 1} of ${pageCount}` });

    for (const reminder of selected) {
        const remaining = Math.max(0, reminder.triggerAt.getTime() - now);
        embed.addFields({
            name: reminder._id,
            value: `${reminder.message.slice(0, 850)}${reminder.message.length > 850 ? "…" : ""}\nDue <t:${Math.floor(reminder.triggerAt.getTime() / 1000)}:R> (${formatDuration(remaining)} remaining)`
        });
    }

    const components = [];
    if (pageCount > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reminders:${token}:${page - 1}`)
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`reminders:${token}:${page + 1}`)
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === pageCount - 1)
        ));
    }

    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function createReminderListPayload(userId, reminders) {
    for (const [token, session] of sessions) {
        if (session.expiresAt <= Date.now()) sessions.delete(token);
    }
    const token = randomUUID();
    if (reminders.length > PAGE_SIZE) {
        sessions.set(token, {
            userId,
            reminders,
            expiresAt: Date.now() + SESSION_LIFETIME_MS
        });
    }
    return renderPage(reminders, 0, token);
}

async function handleReminderListComponent(interaction) {
    if (!interaction.customId || !interaction.customId.startsWith("reminders:")) return false;

    const [, token, pageText] = interaction.customId.split(":");
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        sessions.delete(token);
        await interaction.reply({
            content: "This reminder list has expired. Run `/reminders` again.",
            ephemeral: true
        });
        return true;
    }
    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: "Only the person who opened this reminder list can use these buttons.",
            ephemeral: true
        });
        return true;
    }

    const page = Number(pageText);
    const pageCount = Math.max(1, Math.ceil(session.reminders.length / PAGE_SIZE));
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
        throw new UserFacingError("That reminder list page is invalid.");
    }

    await interaction.update(renderPage(session.reminders, page, token));
    return true;
}

module.exports = {
    createReminderListPayload,
    handleReminderListComponent
};
