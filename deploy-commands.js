require("dotenv").config();

const {
    REST,
    Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const commands = [];

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    commands.push(command.data.toJSON());
}

(async () => {
    const token = process.env.TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;
    if (!token || !clientId) {
        console.error("Command deployment requires TOKEN and CLIENT_ID environment variables.");
        process.exitCode = 1;
        return;
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);

    try {
        console.log(`Registering ${commands.length} slash commands...`);
        await rest.put(route, { body: commands });
        console.log("Slash commands registered.");
    } catch (error) {
        console.error("Slash command deployment failed:", {
            code: error.code || error.name,
            status: error.status
        });
        process.exitCode = 1;
    }
})();