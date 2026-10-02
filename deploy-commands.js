require("dotenv").config();

const {
    REST,
    Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

function loadCommands() {
    const commandsPath = path.join(__dirname, "commands");
    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter(file => file.endsWith(".js"));

    return commandFiles.map(file => {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        return command.data.toJSON();
    });
}

async function deployCommands(rest, commandData, clientId, guildId) {
    console.log(`Registering ${commandData.length} global slash commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body: commandData });
    console.log("Global slash commands registered.");

    if (guildId) {
        console.log(`Registering ${commandData.length} test slash commands in guild ${guildId}...`);
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: commandData
        });
        console.log("Guild test slash commands registered.");
    }
}

async function main() {
    const token = process.env.TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;
    if (!token || !clientId) {
        console.error("Command deployment requires TOKEN and CLIENT_ID environment variables.");
        process.exitCode = 1;
        return;
    }

    const commandData = loadCommands();
    const rest = new REST({ version: "10" }).setToken(token);

    try {
        await deployCommands(rest, commandData, clientId, guildId);
    } catch (error) {
        console.error("Slash command deployment failed:", {
            code: error.code || error.name,
            status: error.status
        });
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Slash command deployment failed:", {
            code: error.code || error.name,
            status: error.status
        });
        process.exitCode = 1;
    });
}

module.exports = {
    loadCommands,
    deployCommands
};