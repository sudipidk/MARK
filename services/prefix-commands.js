const { EmbedBuilder } = require("discord.js");
const { setAfk } = require("./afk");
const { createReminder, cancelReminder, listPendingReminders } = require("./reminder-storage");
const { createReminderListPayload } = require("./reminder-list");
const { UserFacingError, getUserFacingMessage } = require("./errors");
const { getServerData } = require("./counting");

const PREFIX = "m!";
const COMMAND_NAMES = new Set(["afk", "remind", "reminders", "reminder"]);

function parsePrefixCommand(content) {
    const match = content.match(/^m!(\S+)(?:\s+([\s\S]*))?$/i);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (!COMMAND_NAMES.has(name)) return null;
    return { name, args: match[2] || "" };
}

async function replyError(message, error) {
    if (!(error instanceof UserFacingError)) {
        console.error("Prefix command failed:", {
            command: parsePrefixCommand(message.content)?.name,
            code: error.code || error.name
        });
    }

    try {
        await message.reply({
            content: getUserFacingMessage(error),
            allowedMentions: { parse: [] }
        });
    } catch (replyError) {
        console.error("Failed to reply to a prefix command:", {
            messageId: message.id,
            code: replyError.code || replyError.name
        });
    }
}

async function executePrefixCommand(message, command) {
    switch (command.name) {
        case "afk": {
            const record = await setAfk(
                message.guildId,
                message.author.id,
                command.args.trim()
            );
            const embed = new EmbedBuilder()
                .setColor(0x95A5A6)
                .setTitle("💤 AFK Enabled")
                .setDescription(`<@${message.author.id}> is now AFK.\n\nReason: ${record.reason}`);
            await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            return;
        }
        case "remind": {
            const match = command.args.match(/^(\S+)(?:\s+([\s\S]*))?$/);
            if (!match) {
                throw new UserFacingError("Usage: `m!remind <duration> <message>`.");
            }
            const reminder = await createReminder(
                message.author.id,
                match[1],
                match[2] || ""
            );
            await message.reply(
                `I’ll remind you by DM <t:${Math.floor(reminder.triggerAt.getTime() / 1000)}:R>. Reminder ID: \`${reminder._id}\`.`
            );
            return;
        }
        case "reminders": {
            const reminders = await listPendingReminders(message.author.id);
            await message.reply(createReminderListPayload(message.author.id, reminders));
            return;
        }
        case "reminder": {
            const match = command.args.match(/^cancel\s+(\S+)$/i);
            if (!match) {
                throw new UserFacingError("Usage: `m!reminder cancel <id>`.");
            }
            const reminder = await cancelReminder(message.author.id, match[1]);
            await message.reply(`Reminder \`${reminder._id}\` cancelled.`);
        }
    }
}

function isCountingChannel(message) {
    return getServerData(message.guildId).channelId === message.channelId;
}

function registerPrefixCommands(client) {
    client.on("messageCreate", async message => {
        if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;
        if (isCountingChannel(message)) return;

        const command = parsePrefixCommand(message.content);
        if (!command) return;
        try {
            await executePrefixCommand(message, command);
        } catch (error) {
            await replyError(message, error);
        }
    });
}

module.exports = {
    PREFIX,
    parsePrefixCommand,
    executePrefixCommand,
    registerPrefixCommands
};
