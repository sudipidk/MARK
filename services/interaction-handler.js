const { getUserFacingMessage } = require("./errors");
const { handleSuggestionComponent } = require("./suggestions");
const { handleReminderListComponent } = require("./reminder-list");

function logInteractionError(interaction, error) {
    console.error("Interaction failed:", {
        command: interaction.commandName || interaction.customId,
        code: error.code || error.name
    });
}

async function replyWithError(interaction, error) {
    const content = getUserFacingMessage(error);
    try {
        if (interaction.deferred) {
            await interaction.editReply({
                content,
                embeds: [],
                allowedMentions: { parse: [] }
            });
        } else if (interaction.replied) {
            await interaction.followUp({ content, ephemeral: true });
        } else {
            await interaction.reply({ content, ephemeral: true });
        }
    } catch (replyError) {
        logInteractionError(interaction, replyError);
    }
}

function registerInteractionHandler(client) {
    client.on("interactionCreate", async interaction => {
        try {
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (command) await command.execute(interaction);
                return;
            }

            if (interaction.isButton() || interaction.isModalSubmit()) {
                if (interaction.isButton() && await handleReminderListComponent(interaction)) {
                    return;
                }
                await handleSuggestionComponent(interaction);
            }
        } catch (error) {
            logInteractionError(interaction, error);
            await replyWithError(interaction, error);
        }
    });
}

module.exports = {
    registerInteractionHandler
};
