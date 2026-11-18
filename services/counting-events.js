const { getServerData, parseCount, updateServerData } = require("./counting");

async function deleteCountingMessage(message) {
    try {
        await message.delete();
    } catch (error) {
        console.error("Failed to delete a counting-channel message:", {
            messageId: message.id,
            code: error.code || error.name
        });
        return false;
    }

    await updateServerData(message.guildId, data => {
        data.deletedByUser[message.author.id] =
            (data.deletedByUser[message.author.id] || 0) + 1;
    });
    return true;
}

async function punishCountingViolation(message, data) {
    if (data.punishmentMinutes === 0) return false;

    let member;
    try {
        member = message.member || await message.guild.members.fetch(message.author.id);
        await member.timeout(
            data.punishmentMinutes * 60 * 1000,
            "Counting channel rule violation: edited or deleted a counting message"
        );
    } catch (error) {
        console.error("Failed to timeout counting violator:", {
            userId: message.author.id,
            code: error.code || error.name
        });
    }

    const username = message.author?.username
        || message.author?.tag
        || "User";
    try {
        await message.author.send({
            content: `${username}, please follow the counting rules, dont edit or delete your message bruh. You have been timeouted in ${message.guild?.name || "the server"} for ${data.punishmentMinutes} minute${data.punishmentMinutes === 1 ? "" : "s"} for editing/deleting your msg man.`,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("Failed to DM counting violator:", {
            userId: message.author.id,
            code: error.code || error.name
        });
    }
    return true;
}

async function recoverEditedOrDeletedCount(client, message, kind) {
    if (!message?.guildId || !message?.channelId) return;

    if (!message.guild) {
        try {
            message.guild = await client.guilds.fetch(message.guildId);
        } catch (error) {
            console.error("Failed to fetch guild for counting message recovery:", {
                guildId: message.guildId,
                code: error.code || error.name
            });
            return;
        }
    }

    const data = getServerData(message.guildId);
    if (!data.channelId || message.channelId !== data.channelId) return;
    const recorded = data.countedMessages?.[message.id];
    if (!recorded && !data.countedMessageIds.includes(message.id)) return;
    if (message.author?.bot) return;

    if (!message.author && recorded?.authorId && client?.users) {
        try {
            message.author = await client.users.fetch(recorded.authorId);
        } catch (error) {
            console.error("Failed to fetch author of deleted counting message:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }
    }
    if (!message.author) return;

    if (kind === "edit") {
        try {
            await message.delete();
        } catch (error) {
            console.error("Failed to delete an edited counting message:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }
    }

    await updateServerData(message.guildId, serverData => {
        serverData.deletedByUser[message.author.id] =
            (serverData.deletedByUser[message.author.id] || 0) + 1;
    });

    await punishCountingViolation(message, data);

    try {
        const channel = message.channel
            || await message.guild.channels.fetch(message.channelId);
        await channel.send({
            content: String(data.currentCount),
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("Failed to restore a counting message:", {
            messageId: message.id,
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

        await updateServerData(message.guildId, serverData => {
            serverData.currentCount = count.value;
            serverData.highestCount = Math.max(serverData.highestCount, count.value);
            serverData.lastUserId = message.author.id;
            serverData.countedMessageIds = [
                ...serverData.countedMessageIds.filter(id => id !== message.id),
                message.id
            ].slice(-1000);
            serverData.countedMessages = {
                ...serverData.countedMessages,
                [message.id]: {
                    authorId: message.author.id,
                    value: count.value
                }
            };
            const retainedIds = new Set(serverData.countedMessageIds);
            for (const messageId of Object.keys(serverData.countedMessages)) {
                if (!retainedIds.has(messageId)) {
                    delete serverData.countedMessages[messageId];
                }
            }
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
        await updateServerData(message.guildId, serverData => {
            serverData.currentCount = 0;
            serverData.lastUserId = null;
        });
    }
    await punishCountingViolation(message, data);
}

function registerCountingEvents(client) {
    const countingQueues = new Map();
    const editRecoveryQueue = new Set();

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

    client.on("messageUpdate", (oldMessage, newMessage) => {
        if (!newMessage.guild || newMessage.author?.bot) return;

        const queueKey = `${newMessage.guildId}:${newMessage.channelId}:edit`;
        const previous = countingQueues.get(queueKey) || Promise.resolve();
        const current = previous
            .then(async () => {
                editRecoveryQueue.add(newMessage.id);
                setTimeout(() => editRecoveryQueue.delete(newMessage.id), 30000);
                await recoverEditedOrDeletedCount(client, newMessage, "edit");
            })
            .catch(error => {
                console.error("Failed to recover an edited counting message:", {
                    messageId: newMessage.id,
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

    client.on("messageDelete", message => {
        if (!message.guildId || editRecoveryQueue.has(message.id)) return;

        const queueKey = `${message.guildId}:${message.channelId}:delete`;
        const previous = countingQueues.get(queueKey) || Promise.resolve();
        const current = previous
            .then(() => recoverEditedOrDeletedCount(client, message, "delete"))
            .catch(error => {
                console.error("Failed to recover a deleted counting message:", {
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
    processCountingMessage,
    recoverEditedOrDeletedCount
};
