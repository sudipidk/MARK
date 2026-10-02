require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Collection
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const { connectDB } = require("./db");
const { initializeCountingData } = require("./services/counting");

const { registerCountingEvents } = require("./services/counting-events");
const { registerInteractionHandler } = require("./services/interaction-handler");
const { initializeAfkStorage } = require("./services/afk");
const { initializeReminderStorage } = require("./services/reminder-storage");
const { startReminderScheduler } = require("./services/reminder-scheduler");
const { registerAfkMessageEvents } = require("./services/afk-message-handler");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    client.commands.set(command.data.name, command);
}

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    startReminderScheduler(client);
});

async function startBot() {
    try {
        // Connect to MongoDB first
        await connectDB();

        // Load counting data from MongoDB into memory
        await initializeCountingData();
        await initializeAfkStorage();
        await initializeReminderStorage();

        // Register bot event handlers
        registerInteractionHandler(client);
        registerCountingEvents(client);
        registerAfkMessageEvents(client);

        // Login to Discord
        await client.login(process.env.TOKEN);
    } catch (error) {
        console.error("❌ Failed to start bot:", {
            code: error.code || error.name
        });
        process.exit(1);
    }
}

startBot();