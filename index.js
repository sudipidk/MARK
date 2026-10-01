require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Collection
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const { getServerData, parseCount, updateServerData } = require("./services/counting");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
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
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: "❌ An error occurred.",
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: "❌ An error occurred.",
                ephemeral: true
            });
        }
    }
});

async function deleteCountingMessage(message) {
    try {
        await message.delete();
        updateServerData(message.guildId, data => {
            data.deletedByUser[message.author.id] =
                (data.deletedByUser[message.author.id] || 0) + 1;
        });
        return true;
    } catch (error) {
        console.error("Failed to delete a counting-channel message:", error);
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
        console.error(`Failed to timeout counting violator ${message.author.id}:`, error);
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
            console.error(`Failed to react to valid count ${message.id}:`, error);
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

const countingQueues = new Map();

client.on("messageCreate", message => {
    if (!message.guild || message.author.bot) return;

    const queueKey = `${message.guildId}:${message.channelId}`;
    const previous = countingQueues.get(queueKey) || Promise.resolve();
    const current = previous
        .then(() => processCountingMessage(message))
        .catch(error => {
            console.error("Failed to process a counting-channel message:", error);
        });

    countingQueues.set(queueKey, current);
    current.then(() => {
        if (countingQueues.get(queueKey) === current) {
            countingQueues.delete(queueKey);
        }
    });
});

console.log("TOKEN EXISTS:", !!process.env.TOKEN);
console.log("TOKEN LENGTH:", process.env.TOKEN?.length);
console.log("TOKEN FIRST 5:", process.env.TOKEN?.slice(0, 5));
console.log("TOKEN LAST 5:", process.env.TOKEN?.slice(-5));

client.login(process.env.TOKEN);