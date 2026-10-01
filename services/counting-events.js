const { getServerData, parseCount, updateServerData } = require("./counting");

async function deleteCountingMessage(message) {
    try {
        await message.delete();
        updateServerData(message.guildId, data => {
            data.deletedByUser[message.author.id] =
                (data.deletedByUser[message.author.id] || 0) + 1;
        });
        return true;
    } catch (error) {
        console.error("Failed to delete a counting-channel message:", {
            messageId: message.id,
            code: error.code || error.name
        });
        return false;
    }
}

async function punishCountingViolation(message, data) {
    if (data.punishmentMinutes === 0) return;

    try {
        const member = message.member || await message.guild.members.fetch(message.author.id);
        await member.timeout(
            data.punishmentMinutes * 60 * 1000,
            "Counting channel rule violation"
        );
    } catch (error) {
        console.error("Failed to timeout counting violator:", {
            userId: message.author.id,
            code: error.code || error.name
        });
    }
}

async function processCountingMessage(message) {
    const data = getServerData(message.guildId);
    if (!data.channelId || message.channelId !== data.channelId) return;

    const count = parseCount(message.content, data.mathEnabled);
    if (!count.isCount) {
        if (!data.talkEnabled) await deleteCountingMessage(message);
        return;
    }

    if (count.value === data.currentCount) {
        await deleteCountingMessage(message);
        await punishCountingViolation(message, data);
        return;
    }

    if (count.value === data.currentCount + 1) {
        if (data.streakEnabled && data.lastUserId === message.author.id) {
            await deleteCountingMessage(message);
            await punishCountingViolation(message, data);
            return;
        }

        updateServerData(message.guildId, serverData => {
            serverData.currentCount = count.value;
            serverData.highestCount = Math.max(serverData.highestCount, count.value);
            serverData.lastUserId = message.author.id;
            serverData.countsByUser[message.author.id] =
                (serverData.countsByUser[message.author.id] || 0) + 1;
        });

        try {
            await message.react("✅");
        } catch (error) {
            console.error("Failed to react to valid counting message:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }
        return;
    }

    await deleteCountingMessage(message);
    if (!data.cheatEnabled && count.value !== null && count.value > data.currentCount) {
        updateServerData(message.guildId, serverData => {
            serverData.currentCount = 0;
            serverData.lastUserId = null;
        });
    }
    await punishCountingViolation(message, data);
}

function registerCountingEvents(client) {
    const countingQueues = new Map();

    client.on("messageCreate", message => {
        if (!message.guild || message.author.bot) return;

        const queueKey = `${message.guildId}:${message.channelId}`;
        const previous = countingQueues.get(queueKey) || Promise.resolve();
        const current = previous
            .then(() => processCountingMessage(message))
            .catch(error => {
                console.error("Failed to process a counting-channel message:", {
                    messageId: message.id,
                    code: error.code || error.name
                });
            });

        countingQueues.set(queueKey, current);
        current.then(() => {
            if (countingQueues.get(queueKey) === current) {
                countingQueues.delete(queueKey);
            }
        });
    });
}

module.exports = {
    registerCountingEvents,
    processCountingMessage
};
