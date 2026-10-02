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
const {
    getStartupConfig,
    formatStartupError
} = require("./services/startup-diagnostics");

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
    let startupStage = "configuration";
    try {
        const { token } = getStartupConfig();

        // Connect to MongoDB first
        startupStage = "MongoDB connection";
        await connectDB();

        // Load counting data from MongoDB into memory
        startupStage = "counting data initialization";
        await initializeCountingData();
        startupStage = "AFK storage initialization";
        await initializeAfkStorage();
        startupStage = "reminder storage initialization";
        await initializeReminderStorage();

        // Register bot event handlers
        startupStage = "event registration";
        registerInteractionHandler(client);
        registerCountingEvents(client);
        registerAfkMessageEvents(client);

        // Login to Discord
        startupStage = "Discord login";
        await client.login(token);
    } catch (error) {
        console.error(`❌ Failed during ${startupStage}:`, formatStartupError(error, [
            process.env.TOKEN,
            process.env.MONGODB_URI,
            process.env.MONGO_URL
        ]));
        try {
            await client.destroy();
        } catch {
            // Keep the startup failure as the primary error.
        }
        process.exit(1);
    }
}

startBot();