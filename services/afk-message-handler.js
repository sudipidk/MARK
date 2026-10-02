const { registerPrefixCommands, parsePrefixCommand } = require("./prefix-commands");
const { notifyAfkTargets, welcomeBack } = require("./afk-events");

function registerAfkMessageEvents(client) {
    registerPrefixCommands(client);

    client.on("messageCreate", async message => {
        if (!message.guild || message.author.bot) return;
        if (parsePrefixCommand(message.content)) return;

        try {
            await notifyAfkTargets(message);
        } catch (error) {
            console.error("Failed to notify about AFK users:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }

        try {
            await welcomeBack(message);
        } catch (error) {
            console.error("Failed to clear AFK status:", {
                messageId: message.id,
                code: error.code || error.name
            });
        }
    });
}

module.exports = {
    registerAfkMessageEvents
};
