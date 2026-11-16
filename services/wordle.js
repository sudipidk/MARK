const { randomUUID } = require("node:crypto");
const {
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType
} = require("discord.js");
const { getDB, getClient } = require("../db");
const economy = require("./economy");
const { UserFacingError } = require("./errors");
const {
    AUTOMATIC_REWARDS,
    WORD_LENGTH_DISTRIBUTION,
    MINIMUM_AUTOMATIC_REWARD,
    MAXIMUM_CUSTOM_WORD_LENGTH,
    DEFAULT_MAX_ATTEMPTS,
    isValidDictionaryWord,
    isValidGuess,
    validateAutomaticRewards,
    generateAutomaticAnswer,
    evaluateGuess
} = require("./wordle-engine");

const COLLECTIONS = Object.freeze({
    challenges: "wordleChallenges",
    players: "wordlePlayers",
    settings: "wordleSettings",
    stats: "wordleStats"
});

function collections() {
    const database = getDB();
    return {
        challenges: database.collection(COLLECTIONS.challenges),
        players: database.collection(COLLECTIONS.players),
        settings: database.collection(COLLECTIONS.settings),
        stats: database.collection(COLLECTIONS.stats)
    };
}

function defaultSettings(guildId) {
    return {
        guildId,
        channelId: null,
        wordleAdmins: [],
        automaticEnabled: true,
        automaticRewards: { ...AUTOMATIC_REWARDS },
        wordLengthDistribution: { ...WORD_LENGTH_DISTRIBUTION },
        defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
        maximumCustomWordLength: MAXIMUM_CUSTOM_WORD_LENGTH,
        recentAnswerHistory: [],
        challengeSequence: 0,
        createdAt: new Date()
    };
}

async function getSettings(guildId) {
    const { settings } = collections();
    try {
        await settings.updateOne(
            { guildId },
            { $setOnInsert: defaultSettings(guildId) },
            { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    const stored = await settings.findOne({ guildId });
    if (!stored) throw new Error(`Wordle settings could not be loaded for guild ${guildId}.`);
    stored.automaticRewards = validateAutomaticRewards({
        ...AUTOMATIC_REWARDS,
        ...(stored.automaticRewards || {})
    });
    stored.wordLengthDistribution = {
        ...WORD_LENGTH_DISTRIBUTION,
        ...(stored.wordLengthDistribution || {})
    };
    stored.wordleAdmins = Array.isArray(stored.wordleAdmins) ? stored.wordleAdmins : [];
    stored.automaticEnabled = stored.automaticEnabled !== false;
    stored.defaultMaxAttempts ??= DEFAULT_MAX_ATTEMPTS;
    stored.maximumCustomWordLength ??= MAXIMUM_CUSTOM_WORD_LENGTH;
    stored.recentAnswerHistory = Array.isArray(stored.recentAnswerHistory)
        ? stored.recentAnswerHistory
        : [];
    if (!Number.isInteger(stored.defaultMaxAttempts) ||
        stored.defaultMaxAttempts < 1 || stored.defaultMaxAttempts > 20) {
        throw new RangeError("Wordle default attempts must be between 1 and 20.");
    }
    if (!Number.isInteger(stored.maximumCustomWordLength) ||
        stored.maximumCustomWordLength < 1 || stored.maximumCustomWordLength > MAXIMUM_CUSTOM_WORD_LENGTH) {
        throw new RangeError(`Wordle custom word length must be between 1 and ${MAXIMUM_CUSTOM_WORD_LENGTH}.`);
    }
    return stored;
}

async function initializeWordleStorage() {
    const { challenges, players, settings, stats } = collections();
    await Promise.all([
        challenges.createIndex({ challengeId: 1 }, { unique: true }),
        challenges.createIndex(
            { guildId: 1, word: 1 },
            {
                unique: true,
                partialFilterExpression: { liveAnswer: true },
                name: "unique_live_wordle_answer_per_guild"
            }
        ),
        challenges.createIndex(
            { guildId: 1, status: 1 },
            {
                unique: true,
                partialFilterExpression: { status: "active" },
                name: "one_active_wordle_per_guild"
            }
        ),
        challenges.createIndex({ guildId: 1, status: 1, position: 1, createdAt: 1 }),
        challenges.createIndex({ guildId: 1, completedAt: -1 }),
        challenges.createIndex({ paymentStatus: 1, status: 1 }),
        players.createIndex({ challengeId: 1, userId: 1 }, { unique: true }),
        players.createIndex({ guildId: 1, userId: 1, joinedAt: -1 }),
        settings.createIndex({ guildId: 1 }, { unique: true }),
        stats.createIndex({ guildId: 1, userId: 1 }, { unique: true }),
        stats.createIndex({ guildId: 1, gamesWon: -1 }),
        stats.createIndex({ guildId: 1, totalMarkEarned: -1 })
    ]);
}

function createEmbed(title, color = 0x5865f2) {
    return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

function formatNumber(number) {
    return Number(number || 0).toLocaleString("en-US");
}

function challengeNumber(challenge) {
    return String(challenge.number || 0).padStart(3, "0");
}

function activeChallengeFilter(challenge) {
    return {
        guildId: challenge.guildId,
        challengeId: challenge.challengeId,
        status: "active"
    };
}

async function notifyWordleAdmins(client, guildId, channelId) {
    const settings = await getSettings(guildId);
    let ownerId = client.guilds.cache.get(guildId)?.ownerId;
    if (!ownerId) {
        try {
            ownerId = (await client.guilds.fetch(guildId)).ownerId;
        } catch (error) {
            console.error("Could not resolve the Wordle server owner for channel notification:", {
                guildId,
                code: error.code || error.name
            });
        }
    }
    const recipients = new Set([ownerId, ...settings.wordleAdmins]);
    for (const userId of recipients) {
        if (!userId) continue;
        try {
            const user = await client.users.fetch(userId);
            await user.send(`MARK can no longer publish Wordle challenges in <#${channelId}> for server ${guildId}. Please configure a working channel and permissions with \`/wordle set-channel\`.`);
        } catch (error) {
            console.error("Could not notify a Wordle admin about the configured channel:", {
                guildId,
                userId,
                code: error.code || error.name
            });
        }
    }
}

async function requireGuild(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
        throw new UserFacingError("Wordle commands can only be used in a server.");
    }
}

async function isWordleAdmin(interaction, settings) {
    return interaction.user.id === interaction.guild.ownerId ||
        settings.wordleAdmins.includes(interaction.user.id);
}

async function requireWordleAdmin(interaction) {
    await requireGuild(interaction);
    const settings = await getSettings(interaction.guildId);
    if (!await isWordleAdmin(interaction, settings)) {
        throw new UserFacingError("Only the server owner or an authorized Wordle admin can use this command.");
    }
    return settings;
}

async function allocateNumber(settings) {
    const result = await collections().settings.findOneAndUpdate(
        { guildId: settings.guildId },
        { $inc: { challengeSequence: 1 } },
        { returnDocument: "after" }
    );
    return result.challengeSequence;
}

async function publishChallenge(client, challenge) {
    const { challenges } = collections();
    const now = new Date();
    const lease = await challenges.updateOne(
        {
            ...activeChallengeFilter(challenge),
            originalMessageId: { $exists: false },
            $or: [
                { publishLockUntil: { $exists: false } },
                { publishLockUntil: { $lte: now } }
            ]
        },
        { $set: { publishLockUntil: new Date(now.getTime() + 60_000) } }
    );
    if (!lease.modifiedCount) return;

    try {
        const settings = await getSettings(challenge.guildId);
        if (!settings.channelId) {
            await challenges.updateOne(
                activeChallengeFilter(challenge),
                { $unset: { publishLockUntil: "" } }
            );
            return;
        }
        const channel = await client.channels.fetch(settings.channelId);
        if (!channel || !channel.isTextBased() ||
            ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            throw new UserFacingError("The configured Wordle channel is unavailable. Set a valid channel with `/wordle set-channel`.");
        }
        const marker = `Wordle challenge ${challenge.challengeId}`;
        const recentMessages = await channel.messages.fetch({ limit: 100 });
        const alreadyPublished = recentMessages.find(message =>
            message.author.id === client.user.id &&
            message.embeds.some(embed => embed.footer?.text === marker)
        );
        if (alreadyPublished) {
            await challenges.updateOne(
                activeChallengeFilter(challenge),
                {
                    $set: {
                        channelId: channel.id,
                        originalMessageId: alreadyPublished.id,
                        publishedAt: new Date()
                    },
                    $unset: { publishLockUntil: "" }
                }
            );
            return;
        }
        const announcement = createEmbed(`WORDLE #${challengeNumber(challenge)}`)
            .setDescription([
                challenge.title ? `**${challenge.title}**` : "A new Wordle challenge is live!",
                `Guess the ${challenge.word.length}-letter word by replying to this message or a MARK feedback message.`,
                `Attempts per player: **${challenge.maxAttempts}**`,
                `Prize: **${formatNumber(challenge.reward)} MARK**`
            ].join("\n\n"))
            .setFooter({ text: marker });
        const sent = await channel.send({
            embeds: [announcement],
            allowedMentions: { parse: [] }
        });
        await challenges.updateOne(
            activeChallengeFilter(challenge),
            {
                $set: {
                    channelId: channel.id,
                    originalMessageId: sent.id,
                    publishedAt: new Date()
                },
                $unset: { publishLockUntil: "" }
            }
        );
    } catch (error) {
        await challenges.updateOne(
            activeChallengeFilter(challenge),
            { $unset: { publishLockUntil: "" }, $set: { publishErrorAt: new Date() } }
        );
        console.error("Wordle challenge publishing failed:", {
            guildId: challenge.guildId,
            challengeId: challenge.challengeId,
            code: error.code || error.name
        });
        const shouldNotify = await challenges.updateOne(
            {
                challengeId: challenge.challengeId,
                channelFailureNotifiedAt: { $exists: false }
            },
            { $set: { channelFailureNotifiedAt: new Date() } }
        );
        if (shouldNotify.modifiedCount) {
            await notifyWordleAdmins(client, challenge.guildId, challenge.channelId);
        }
        throw error;
    }
}

async function enqueueCustomChallenge({ guildId, word, reward, title = "", maxAttempts, createdBy }) {
    const normalized = String(word || "").toUpperCase();
    const settings = await getSettings(guildId);
    if (!/^[A-Z]+$/.test(normalized) || normalized.length < 1 ||
        normalized.length > settings.maximumCustomWordLength) {
        throw new UserFacingError(`Choose an alphabetic dictionary word between 1 and ${settings.maximumCustomWordLength} letters.`);
    }
    if (!isValidDictionaryWord(normalized)) {
        throw new UserFacingError("That answer is not in MARK's curated Wordle dictionary.");
    }
    if (!Number.isSafeInteger(reward) || reward < 1) {
        throw new UserFacingError("The reward must be a positive whole number of MARK.");
    }
    if (maxAttempts !== undefined &&
        (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)) {
        throw new UserFacingError("Attempts must be between 1 and 20.");
    }
    const { challenges } = collections();
    if (await challenges.findOne({
        guildId,
        word: normalized,
        liveAnswer: true,
        status: { $in: ["active", "queued"] }
    })) {
        throw new UserFacingError("That answer is already active or queued in this server.");
    }
    const tail = await challenges.find(
        { guildId, status: "queued" },
        { projection: { position: 1 } }
    ).sort({ position: -1 }).limit(1).next();
    const challenge = {
        challengeId: randomUUID(),
        number: await allocateNumber(settings),
        guildId,
        word: normalized,
        type: "custom",
        title: String(title || "").trim().slice(0, 100),
        reward,
        maxAttempts: maxAttempts || settings.defaultMaxAttempts,
        status: "queued",
        position: (tail?.position || 0) + 1,
        createdBy,
        createdAt: new Date(),
        paymentStatus: "not_required",
        associatedMessageIds: []
    };
    try {
        await challenges.insertOne(challenge);
    } catch (error) {
        if (error.code !== 11000) throw error;
        throw new UserFacingError("That answer is already active or queued in this server.");
    }
    await ensureActiveChallenge(guildId);
    return challenge;
}

async function ensureActiveChallenge(guildId) {
    const { challenges } = collections();
    let active = await challenges.findOne({ guildId, status: "active" });
    if (!active) {
        const settings = await getSettings(guildId);
        if (!settings.channelId) return null;
        const queued = await challenges.findOne(
            { guildId, status: "queued" },
            { sort: { position: 1, createdAt: 1 } }
        );
        if (queued) {
            try {
                const result = await challenges.updateOne(
                    { challengeId: queued.challengeId, status: "queued" },
                    {
                        $set: {
                            status: "active",
                            channelId: settings.channelId,
                            startedAt: new Date()
                        },
                        $unset: { position: "" }
                    }
                );
                if (result.modifiedCount) {
                    active = await challenges.findOne({ challengeId: queued.challengeId });
                }
            } catch (error) {
                if (error.code !== 11000) throw error;
                active = await challenges.findOne({ guildId, status: "active" });
            }
        } else if (settings.automaticEnabled) {
            const generated = generateAutomaticAnswer({
                rewards: settings.automaticRewards,
                distribution: settings.wordLengthDistribution,
                excludeWords: settings.recentAnswerHistory
            });
            const challenge = {
                challengeId: randomUUID(),
                number: await allocateNumber(settings),
                guildId,
                word: generated.word,
                liveAnswer: true,
                type: "automatic",
                title: "",
                reward: generated.reward,
                maxAttempts: settings.defaultMaxAttempts,
                status: "active",
                createdBy: null,
                createdAt: new Date(),
                startedAt: new Date(),
                channelId: settings.channelId,
                paymentStatus: "not_required",
                associatedMessageIds: []
            };
            if (challenge.reward < MINIMUM_AUTOMATIC_REWARD) {
                throw new Error("Automatic Wordle reward is below the configured minimum.");
            }
            try {
                await challenges.insertOne(challenge);
                active = challenge;
                await collections().settings.updateOne(
                    { guildId },
                    { $push: { recentAnswerHistory: { $each: [challenge.word], $slice: -50 } } }
                );
            } catch (error) {
                if (error.code !== 11000) throw error;
                active = await challenges.findOne({ guildId, status: "active" });
                if (!active) active = await ensureActiveChallenge(guildId);
            }
        }
    }
    if (active) return active;
    return null;
}

async function activateNextChallenge(client, guildId) {
    const active = await ensureActiveChallenge(guildId);
    if (active) await publishChallenge(client, active);
    return active;
}

async function publishNextAfterCompletion(client, guildId) {
    const active = await activateNextChallenge(client, guildId);
    return Boolean(active);
}

async function addPlayerIfMissing(challenge, userId) {
    const { players } = collections();
    try {
        const result = await players.updateOne(
            { challengeId: challenge.challengeId, userId },
            {
                $setOnInsert: {
                    challengeId: challenge.challengeId,
                    guildId: challenge.guildId,
                    userId,
                    guesses: [],
                    attempts: 0,
                    status: "playing",
                    joinedAt: new Date()
                }
            },
            { upsert: true }
        );
        if (result.upsertedCount) {
            await collections().stats.updateOne(
                { guildId: challenge.guildId, userId },
                {
                    $setOnInsert: { guildId: challenge.guildId, userId, createdAt: new Date() },
                    $inc: { gamesPlayed: 1 }
                },
                { upsert: true }
            );
        }
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    return players.findOne({ challengeId: challenge.challengeId, userId });
}

function renderGuess(guess, marks) {
    const tiles = { green: "🟩", yellow: "🟨", gray: "⬛" };
    return [...guess].map((letter, index) => `${tiles[marks[index]]} ${letter}`).join("  ");
}

async function sendAssociatedMessage(channel, challenge, content, embed) {
    const message = await channel.send({
        content,
        embeds: embed ? [embed] : [],
        allowedMentions: { parse: ["users"] }
    });
    await collections().challenges.updateOne(
        activeChallengeFilter(challenge),
        { $addToSet: { associatedMessageIds: message.id } }
    );
    return message;
}

async function recordPlayerStats(challenge, player) {
    await collections().stats.updateOne(
        { guildId: challenge.guildId, userId: player.userId },
        { $inc: { totalGuesses: 1 } }
    );
}

async function sendWinnerAnnouncement(client, challenge) {
    const { challenges } = collections();
    const now = new Date();
    const lock = await challenges.updateOne(
        {
            challengeId: challenge.challengeId,
            status: "completed",
            liveAnswer: false,
            paymentStatus: "paid",
            winnerAnnouncedAt: { $exists: false },
            $or: [
                { winnerAnnouncementLockUntil: { $exists: false } },
                { winnerAnnouncementLockUntil: { $lte: now } }
            ]
        },
        { $set: { winnerAnnouncementLockUntil: new Date(now.getTime() + 60_000) } }
    );
    if (!lock.modifiedCount) return;
    try {
        const channel = await client.channels.fetch(challenge.channelId);
        if (!channel?.isTextBased()) throw new Error("The Wordle announcement channel is unavailable.");
        const next = await ensureActiveChallenge(challenge.guildId);
        const embed = createEmbed("🏆 WORDLE COMPLETED!", 0x57f287)
            .setDescription([
                `Congratulations <@${challenge.winnerId}>!`,
                `You solved Wordle #${challengeNumber(challenge)}!`,
                `Answer: \`${challenge.word}\``,
                `Attempts used: **${challenge.winningAttempts}/${challenge.maxAttempts}**`,
                `Prize received: **+${formatNumber(challenge.reward)} MARK**`,
                next ? "The next Wordle challenge is now available!" : "The next challenge is being prepared."
            ].join("\n\n"));
        await channel.send({
            embeds: [embed],
            allowedMentions: { users: [challenge.winnerId] }
        });
        await challenges.updateOne(
            { challengeId: challenge.challengeId, status: "completed" },
            {
                $set: { winnerAnnouncedAt: new Date() },
                $unset: { winnerAnnouncementLockUntil: "" }
            }
        );
    } catch (error) {
        await challenges.updateOne(
            { challengeId: challenge.challengeId, status: "completed" },
            {
                $unset: { winnerAnnouncementLockUntil: "" },
                $set: { winnerAnnouncementAttemptAt: new Date() }
            }
        );
        console.error("Wordle winner announcement failed:", {
            guildId: challenge.guildId,
            challengeId: challenge.challengeId,
            code: error.code || error.name
        });
    }
}

async function markWordleRewardPaid(challenge) {
    const { challenges, stats } = collections();
    const session = getClient().startSession();
    try {
        await session.withTransaction(async () => {
            const result = await challenges.updateOne(
                {
                    challengeId: challenge.challengeId,
                    status: "completed",
                    paymentStatus: "pending"
                },
                { $set: { paymentStatus: "paid", paidAt: new Date() } },
                { session }
            );
            if (!result.modifiedCount) return;
            await stats.updateOne(
                { guildId: challenge.guildId, userId: challenge.winnerId },
                { $inc: { totalMarkEarned: challenge.reward } },
                { session }
            );
        });
    } finally {
        await session.endSession();
    }
}

async function settleWinner(client, challenge, userId, attempts) {
    const { challenges, players } = collections();
    const now = new Date();
    const session = getClient().startSession();
    let won;
    try {
        await session.withTransaction(async () => {
            const participantCount = await players.countDocuments(
                { challengeId: challenge.challengeId },
                { session }
            );
            const eliminatedCount = await players.countDocuments(
                { challengeId: challenge.challengeId, status: "eliminated" },
                { session }
            );
            won = await challenges.findOneAndUpdate(
                { ...activeChallengeFilter(challenge) },
                {
                    $set: {
                        status: "completed",
                        liveAnswer: false,
                        winnerId: userId,
                        winningAttempts: attempts,
                        participantCount,
                        eliminatedCount,
                        completedAt: now,
                        paymentStatus: "pending"
                    }
                },
                { returnDocument: "after", session }
            );
            if (!won) return;

            await players.updateOne(
                { challengeId: challenge.challengeId, userId, status: "playing" },
                { $set: { status: "won", completedAt: now } },
                { session }
            );
            const { stats } = collections();
            await stats.updateOne(
                { guildId: challenge.guildId, userId },
                {
                    $inc: {
                        gamesWon: 1,
                        winningAttemptsTotal: attempts,
                        currentStreak: 1
                    }
                },
                { session }
            );
            const updatedStats = await stats.findOne(
                { guildId: challenge.guildId, userId },
                { session }
            );
            await stats.updateOne(
                { guildId: challenge.guildId, userId },
                { $max: { bestStreak: updatedStats.currentStreak } },
                { session }
            );
        });
    } finally {
        await session.endSession();
    }
    if (!won) return { won: false };

    try {
        await economy.creditWordleReward({
            guildId: challenge.guildId,
            userId,
            challengeId: challenge.challengeId,
            amount: challenge.reward
        });
        await markWordleRewardPaid(won);
    } catch (error) {
        await challenges.updateOne(
            { challengeId: challenge.challengeId, paymentStatus: "pending" },
            { $set: { paymentErrorAt: new Date() } }
        );
        console.error("Wordle reward payment is pending retry:", {
            guildId: challenge.guildId,
            challengeId: challenge.challengeId,
            code: error.code || error.name
        });
        return { won: true, paid: false, challenge: won };
    }

    await sendWinnerAnnouncement(client, won);
    await publishNextAfterCompletion(client, challenge.guildId);
    return { won: true, paid: true, challenge: won };
}

async function retryPendingPayments(client) {
    const { challenges } = collections();
    const pending = await challenges.find(
        { status: "completed", paymentStatus: "pending", winnerId: { $type: "string" } }
    ).sort({ paymentErrorAt: 1, completedAt: 1 }).limit(100).toArray();
    for (const challenge of pending) {
        try {
            await economy.creditWordleReward({
                guildId: challenge.guildId,
                userId: challenge.winnerId,
                challengeId: challenge.challengeId,
                amount: challenge.reward
            });
            await markWordleRewardPaid(challenge);
            await sendWinnerAnnouncement(client, challenge);
            await publishNextAfterCompletion(client, challenge.guildId);
        } catch (error) {
            await challenges.updateOne(
                { challengeId: challenge.challengeId, paymentStatus: "pending" },
                { $set: { paymentErrorAt: new Date() } }
            );
            console.error("Wordle reward retry failed:", {
                guildId: challenge.guildId,
                challengeId: challenge.challengeId,
                code: error.code || error.name
            });
        }
    }
    const unannounced = await challenges.find({
        status: "completed",
        paymentStatus: "paid",
        winnerAnnouncedAt: { $exists: false }
    }).sort({ winnerAnnouncementAttemptAt: 1, completedAt: 1 }).limit(100).toArray();
    for (const challenge of unannounced) {
        await sendWinnerAnnouncement(client, challenge);
        await publishNextAfterCompletion(client, challenge.guildId);
    }
}

async function handleGuessMessage(client, message) {
    if (!message.guildId || message.author.bot || message.webhookId || !message.reference?.messageId) return;
    const { challenges, players } = collections();
    const challenge = await challenges.findOne({
        guildId: message.guildId,
        status: "active",
        $or: [
            { originalMessageId: message.reference.messageId },
            { associatedMessageIds: message.reference.messageId }
        ]
    });
    if (!challenge || (challenge.channelId && challenge.channelId !== message.channelId)) return;
    const guess = message.content.trim().toUpperCase();
    if (!isValidGuess(guess, challenge.word)) {
        if (!/^[A-Z]+$/.test(guess)) {
            await sendAssociatedMessage(message.channel, challenge, `<@${message.author.id}> Guess using letters only.`);
            return;
        }
        if (guess.length !== challenge.word.length) {
            await sendAssociatedMessage(
                message.channel,
                challenge,
                `<@${message.author.id}> Your guess must contain exactly ${challenge.word.length} letters.`
            );
        }
        return;
    }
    const player = await addPlayerIfMissing(challenge, message.author.id);
    if (player.status !== "playing") {
        await sendAssociatedMessage(message.channel, challenge, `<@${message.author.id}> You are ${player.status} in this challenge.`);
        return;
    }
    const marks = evaluateGuess(guess, challenge.word);
    const addGuess = await players.updateOne(
        {
            challengeId: challenge.challengeId,
            userId: message.author.id,
            status: "playing",
            attempts: { $lt: challenge.maxAttempts },
            guesses: {
                $not: {
                    $elemMatch: {
                        $or: [{ guess }, { messageId: message.id }]
                    }
                }
            }
        },
        {
            $push: {
                guesses: {
                    guess,
                    marks,
                    messageId: message.id,
                    createdAt: new Date()
                }
            },
            $inc: { attempts: 1 }
        }
    );
    if (!addGuess.modifiedCount) {
        const latest = await players.findOne({ challengeId: challenge.challengeId, userId: message.author.id });
        const response = latest?.guesses.some(item => item.guess === guess)
            ? "You already tried that word; it did not use an attempt."
            : latest?.status === "eliminated"
                ? `You have been eliminated from Wordle #${challengeNumber(challenge)}.`
                : "This challenge is no longer accepting your guesses.";
        await sendAssociatedMessage(message.channel, challenge, `<@${message.author.id}> ${response}`);
        return;
    }
    const updatedPlayer = await players.findOne({ challengeId: challenge.challengeId, userId: message.author.id });
    await recordPlayerStats(challenge, updatedPlayer);

    const feedback = createEmbed(`Wordle #${challengeNumber(challenge)} — Guess ${updatedPlayer.attempts}/${challenge.maxAttempts}`)
        .setDescription(renderGuess(guess, marks))
        .setFooter({ text: "Each player's attempts are tracked separately." });
    await sendAssociatedMessage(message.channel, challenge, `<@${message.author.id}>`, feedback);

    if (marks.every(mark => mark === "green")) {
        const result = await settleWinner(client, challenge, message.author.id, updatedPlayer.attempts);
        if (result.won && !result.paid) {
            await sendAssociatedMessage(
                message.channel,
                challenge,
                "The winner has been recorded. The prize is pending a safe economy retry."
            );
        }
        return;
    }

    if (updatedPlayer.attempts >= challenge.maxAttempts) {
        await players.updateOne(
            { challengeId: challenge.challengeId, userId: message.author.id, status: "playing" },
            { $set: { status: "eliminated", completedAt: new Date() } }
        );
        await collections().stats.updateOne(
            { guildId: challenge.guildId, userId: message.author.id },
            { $inc: { gamesEliminated: 1 }, $set: { currentStreak: 0 } }
        );
        await sendAssociatedMessage(
            message.channel,
            challenge,
            `❌ <@${message.author.id}> You've been eliminated from Wordle #${challengeNumber(challenge)}. You used all ${challenge.maxAttempts} attempts. Better luck on the next challenge!`
        );
    }
}

function registerWordleMessageEvents(client) {
    client.on("messageCreate", message => {
        handleGuessMessage(client, message).catch(error => {
            console.error("Wordle guess processing failed:", {
                messageId: message.id,
                code: error.code || error.name
            });
        });
    });
    client.on("messageDelete", message => {
        if (!message.guildId) return;
        const { challenges } = collections();
        challenges.updateOne(
            { guildId: message.guildId, status: "active", originalMessageId: message.id },
            { $unset: { originalMessageId: "" } }
        ).then(async result => {
            if (result.modifiedCount) {
                const challenge = await challenges.findOne({ guildId: message.guildId, status: "active" });
                if (challenge) await publishChallenge(client, challenge);
                return;
            }
            await challenges.updateOne(
                { guildId: message.guildId, status: "active" },
                { $pull: { associatedMessageIds: message.id } }
            );
        }).catch(error => {
            console.error("Wordle deleted-message recovery failed:", {
                messageId: message.id,
                code: error.code || error.name
            });
        });
    });
}

async function setWordleChannel(interaction, channel) {
    await requireWordleAdmin(interaction);
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        throw new UserFacingError("Choose a text or announcement channel in this server.");
    }
    const me = await interaction.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
    ];
    if (!permissions || required.some(permission => !permissions.has(permission))) {
        throw new UserFacingError("MARK needs View Channel, Send Messages, and Read Message History permissions there.");
    }
    await collections().settings.updateOne(
        { guildId: interaction.guildId },
        { $set: { channelId: channel.id, channelUpdatedBy: interaction.user.id, updatedAt: new Date() } }
    );
    await collections().challenges.updateOne(
        { guildId: interaction.guildId, status: "active" },
        {
            $set: { channelId: channel.id },
            $unset: {
                originalMessageId: "",
                publishLockUntil: "",
                channelFailureNotifiedAt: ""
            }
        }
    );
    await interaction.editReply({ content: `Wordle announcements will be published in <#${channel.id}>.` });
    await activateNextChallenge(interaction.client, interaction.guildId);
}

async function removeQueuedChallenge(guildId, challengeId) {
    const { challenges } = collections();
    const result = await challenges.deleteOne({ guildId, challengeId, status: "queued" });
    if (!result.deletedCount) throw new UserFacingError("That queued challenge was not found. Active challenges cannot be removed.");
    const remaining = await challenges.find({ guildId, status: "queued" })
        .sort({ position: 1, createdAt: 1 }).toArray();
    await Promise.all(remaining.map((challenge, index) =>
        challenges.updateOne(
            { challengeId: challenge.challengeId, status: "queued" },
            { $set: { position: index + 1 } }
        )
    ));
}

async function reorderChallenge(guildId, challengeId, position) {
    const { challenges } = collections();
    const queue = await challenges.find({ guildId, status: "queued" })
        .sort({ position: 1, createdAt: 1 }).toArray();
    const index = queue.findIndex(challenge => challenge.challengeId === challengeId);
    if (index < 0) throw new UserFacingError("That queued challenge was not found.");
    if (!Number.isInteger(position) || position < 1 || position > queue.length) {
        throw new UserFacingError(`Position must be between 1 and ${queue.length}.`);
    }
    const [selected] = queue.splice(index, 1);
    queue.splice(position - 1, 0, selected);
    await Promise.all(queue.map((challenge, queueIndex) =>
        challenges.updateOne(
            { challengeId: challenge.challengeId, status: "queued" },
            { $set: { position: queueIndex + 1 } }
        )
    ));
}

async function editQueuedChallenge(guildId, challengeId, changes, editorId) {
    const { challenges } = collections();
    const challenge = await challenges.findOne({ guildId, challengeId, status: "queued" });
    if (!challenge) throw new UserFacingError("Only a pending queued challenge can be edited.");
    const update = {};
    if (changes.word !== null) {
        const word = String(changes.word).toUpperCase();
        const settings = await getSettings(guildId);
        if (!/^[A-Z]+$/.test(word) || word.length < 1 ||
            word.length > settings.maximumCustomWordLength || !isValidDictionaryWord(word)) {
            throw new UserFacingError(`The answer must be an alphabetic dictionary word of 1 to ${settings.maximumCustomWordLength} letters.`);
        }
        if (await challenges.findOne({
            guildId,
            word,
            status: { $in: ["active", "queued"] },
            challengeId: { $ne: challengeId }
        })) throw new UserFacingError("That answer is already active or queued.");
        update.word = word;
    }
    if (changes.title !== null) update.title = String(changes.title || "").trim().slice(0, 100);
    if (changes.reward !== null) {
        if (!Number.isSafeInteger(changes.reward) || changes.reward < 1) {
            throw new UserFacingError("The reward must be a positive whole number.");
        }
        update.reward = changes.reward;
    }
    if (!Object.keys(update).length) throw new UserFacingError("Provide at least one field to edit.");
    update.updatedAt = new Date();
    update.updatedBy = editorId;
    try {
        await challenges.updateOne({ challengeId, status: "queued" }, { $set: update });
    } catch (error) {
        if (error.code !== 11000) throw error;
        throw new UserFacingError("That answer is already active or queued in this server.");
    }
}

async function completeChallenge(client, interaction, status) {
    const { challenges } = collections();
    const activeBefore = await challenges.findOne({ guildId: interaction.guildId, status: "active" });
    if (!activeBefore) throw new UserFacingError("There is no active Wordle challenge.");
    const [participantCount, eliminatedCount] = await Promise.all([
        collections().players.countDocuments({ challengeId: activeBefore.challengeId }),
        collections().players.countDocuments({ challengeId: activeBefore.challengeId, status: "eliminated" })
    ]);
    const challenge = await challenges.findOneAndUpdate(
        { guildId: interaction.guildId, status: "active" },
        {
            $set: {
                status,
                liveAnswer: false,
                completedAt: new Date(),
                paymentStatus: "not_required",
                endedBy: interaction.user.id,
                participantCount,
                eliminatedCount
            }
        },
        { returnDocument: "after" }
    );
    if (!challenge) throw new UserFacingError("There is no active Wordle challenge.");
    await interaction.editReply({ content: `Wordle #${challengeNumber(challenge)} was ${status}.` });
    const channel = await interaction.client.channels.fetch(challenge.channelId);
    if (channel?.isTextBased()) {
        const content = status === "skipped"
            ? `⏭️ Wordle #${challengeNumber(challenge)} was skipped. The answer was \`${challenge.word}\`.`
            : `🛑 Wordle #${challengeNumber(challenge)} has ended. The answer was \`${challenge.word}\`.`;
        await channel.send({ content, allowedMentions: { parse: [] } });
    }
    await activateNextChallenge(interaction.client, interaction.guildId);
}

async function revealChallenge(client, interaction) {
    const challenge = await collections().challenges.findOne({ guildId: interaction.guildId, status: "active" });
    if (!challenge) throw new UserFacingError("There is no active Wordle challenge.");
    await interaction.editReply({ content: `The answer to Wordle #${challengeNumber(challenge)} is \`${challenge.word}\`.` });
}

async function showQueue(interaction) {
    const { challenges } = collections();
    const active = await challenges.findOne({ guildId: interaction.guildId, status: "active" });
    const queued = await challenges.find({ guildId: interaction.guildId, status: "queued" })
        .sort({ position: 1, createdAt: 1 }).toArray();
    const rows = [
        active
            ? `**Active:** Wordle #${challengeNumber(active)} — ${active.title || `${active.word.length}-letter ${active.type}`} — ${formatNumber(active.reward)} MARK`
            : "**Active:** None"
    ];
    if (queued.length) {
        rows.push("", "**Pending:**", ...queued.map((challenge, index) =>
            `${index + 1}. Wordle #${challengeNumber(challenge)} — ${challenge.title || `${challenge.word.length}-letter custom`} — ${formatNumber(challenge.reward)} MARK (ID \`${challenge.challengeId}\`)`
        ));
    } else rows.push("", "No custom challenges are queued.");
    await interaction.editReply({
        embeds: [createEmbed("Wordle Queue").setDescription(rows.join("\n"))]
    });
}

async function personalStats(interaction) {
    const stats = await collections().stats.findOne({ guildId: interaction.guildId, userId: interaction.user.id }) || {};
    const average = stats.gamesWon
        ? (Number(stats.winningAttemptsTotal || 0) / stats.gamesWon).toFixed(2)
        : "—";
    const embed = createEmbed(`${interaction.user.username}'s Wordle Stats`)
        .addFields(
            { name: "Played", value: String(stats.gamesPlayed || 0), inline: true },
            { name: "Won", value: String(stats.gamesWon || 0), inline: true },
            { name: "Eliminated", value: String(stats.gamesEliminated || 0), inline: true },
            { name: "Current streak", value: String(stats.currentStreak || 0), inline: true },
            { name: "Best streak", value: String(stats.bestStreak || 0), inline: true },
            { name: "MARK earned", value: formatNumber(stats.totalMarkEarned), inline: true },
            { name: "Average attempts per win", value: average, inline: true },
            { name: "Total guesses", value: String(stats.totalGuesses || 0), inline: true }
        );
    await interaction.editReply({ embeds: [embed] });
}

async function showLeaderboard(interaction, category) {
    const sortFields = {
        wins: { gamesWon: -1, userId: 1 },
        earnings: { totalMarkEarned: -1, userId: 1 },
        streak: { bestStreak: -1, userId: 1 }
    };
    const stats = collections().stats;
    const rows = category === "average"
        ? await stats.aggregate([
            { $match: { guildId: interaction.guildId, gamesWon: { $gt: 0 } } },
            { $addFields: { averageAttempts: { $divide: ["$winningAttemptsTotal", "$gamesWon"] } } },
            { $sort: { averageAttempts: 1, gamesWon: -1, userId: 1 } },
            { $limit: 10 }
        ]).toArray()
        : await stats.find({ guildId: interaction.guildId })
            .sort(sortFields[category] || sortFields.wins).limit(10).toArray();
    const lines = rows.map((row, index) => {
        const value = category === "earnings"
            ? `${formatNumber(row.totalMarkEarned)} MARK`
            : category === "streak"
                ? `${row.bestStreak || 0} streak`
                : category === "average"
                    ? `${Number(row.averageAttempts).toFixed(2)} attempts`
                    : `${row.gamesWon || 0} wins`;
        return `**${index + 1}.** <@${row.userId}> — ${value}`;
    });
    await interaction.editReply({
        embeds: [createEmbed("Wordle Leaderboard").setDescription(lines.join("\n") || "No Wordle stats yet.")]
    });
}

async function showHistory(interaction) {
    const history = await collections().challenges.find(
        { guildId: interaction.guildId, status: { $in: ["completed", "skipped", "cancelled"] } },
        { projection: { word: 1, type: 1, title: 1, number: 1, winnerId: 1, reward: 1, winningAttempts: 1, participantCount: 1, eliminatedCount: 1, startedAt: 1, completedAt: 1, status: 1 } }
    ).sort({ completedAt: -1 }).limit(10).toArray();
    const description = history.map(challenge =>
        `**#${challengeNumber(challenge)} ${challenge.title || challenge.type}** — \`${challenge.word}\` • ${challenge.status}\n` +
        `Winner: ${challenge.winnerId ? `<@${challenge.winnerId}> (${challenge.winningAttempts} attempts)` : "None"} • ${formatNumber(challenge.reward)} MARK`
    ).join("\n\n") || "No completed Wordle challenges yet.";
    await interaction.editReply({ embeds: [createEmbed("Recent Wordle History").setDescription(description)] });
}

async function showAdminStats(interaction) {
    const { challenges, players } = collections();
    const summary = await challenges.aggregate([
        { $match: { guildId: interaction.guildId } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                automatic: { $sum: { $cond: [{ $eq: ["$type", "automatic"] }, 1, 0] } },
                custom: { $sum: { $cond: [{ $eq: ["$type", "custom"] }, 1, 0] } },
                totalAwarded: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$reward", 0] } },
                completionTimeTotal: {
                    $sum: {
                        $cond: [
                            { $and: [{ $ne: ["$startedAt", null] }, { $ne: ["$completedAt", null] }] },
                            { $subtract: ["$completedAt", "$startedAt"] },
                            0
                        ]
                    }
                },
                completedCount: { $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] } }
            }
        }
    ]).next() || {};
    const participantCount = await players.countDocuments({ guildId: interaction.guildId });
    const victories = await players.countDocuments({ guildId: interaction.guildId, status: "won" });
    const eliminations = await players.countDocuments({ guildId: interaction.guildId, status: "eliminated" });
    const averageMs = summary.completedCount
        ? summary.completionTimeTotal / summary.completedCount
        : 0;
    const embed = createEmbed("Wordle Server Statistics").addFields(
        { name: "Challenges", value: String(summary.total || 0), inline: true },
        { name: "Automatic", value: String(summary.automatic || 0), inline: true },
        { name: "Custom", value: String(summary.custom || 0), inline: true },
        { name: "Participants", value: String(participantCount), inline: true },
        { name: "Victories", value: String(victories), inline: true },
        { name: "Eliminations", value: String(eliminations), inline: true },
        { name: "MARK awarded", value: formatNumber(summary.totalAwarded), inline: true },
        { name: "Avg. completion time", value: `${(averageMs / 3_600_000).toFixed(1)} hours`, inline: true }
    );
    await interaction.editReply({ embeds: [embed] });
}

async function toggleWordleAdmin(interaction, target) {
    await requireGuild(interaction);
    if (interaction.user.id !== interaction.guild.ownerId) {
        throw new UserFacingError("Only the actual server owner can appoint or remove Wordle admins.");
    }
    if (target.bot) throw new UserFacingError("Bots cannot be appointed as Wordle admins.");
    const settings = await getSettings(interaction.guildId);
    const exists = settings.wordleAdmins.includes(target.id);
    await collections().settings.updateOne(
        { guildId: interaction.guildId },
        exists
            ? { $pull: { wordleAdmins: target.id } }
            : { $addToSet: { wordleAdmins: target.id } }
    );
    await interaction.editReply({
        content: `${target} ${exists ? "is no longer" : "is now"} a Wordle admin.`,
        allowedMentions: { users: [] }
    });
}

async function updateWordleSettings(interaction) {
    const settings = await requireWordleAdmin(interaction);
    const changes = {};
    const automaticEnabled = interaction.options.getBoolean("automatic-enabled");
    const reward5 = interaction.options.getInteger("reward-5");
    const reward6 = interaction.options.getInteger("reward-6");
    const reward7 = interaction.options.getInteger("reward-7");
    const defaultAttempts = interaction.options.getInteger("default-attempts");
    const maximumCustomWordLength = interaction.options.getInteger("maximum-custom-word-length");
    const fivePercent = interaction.options.getInteger("five-percent");
    const sixPercent = interaction.options.getInteger("six-percent");

    if (automaticEnabled !== null) changes.automaticEnabled = automaticEnabled;
    const rewards = {
        ...settings.automaticRewards,
        ...(reward5 === null ? {} : { 5: reward5 }),
        ...(reward6 === null ? {} : { 6: reward6 }),
        ...(reward7 === null ? {} : { 7: reward7 })
    };
    validateAutomaticRewards(rewards);
    if (reward5 !== null || reward6 !== null || reward7 !== null) {
        changes.automaticRewards = rewards;
    }
    if (defaultAttempts !== null) changes.defaultMaxAttempts = defaultAttempts;
    if (maximumCustomWordLength !== null) changes.maximumCustomWordLength = maximumCustomWordLength;
    if (fivePercent !== null || sixPercent !== null) {
        const distribution = {
            ...settings.wordLengthDistribution,
            ...(fivePercent === null ? {} : { 5: fivePercent }),
            ...(sixPercent === null ? {} : { 6: sixPercent })
        };
        distribution[7] = 100 - distribution[5] - distribution[6];
        if (distribution[7] < 0) {
            throw new UserFacingError("The 5- and 6-letter percentages cannot total more than 100.");
        }
        changes.wordLengthDistribution = distribution;
    }
    if (!Object.keys(changes).length) {
        throw new UserFacingError("Provide at least one setting to update.");
    }
    await collections().settings.updateOne(
        { guildId: interaction.guildId },
        { $set: { ...changes, updatedAt: new Date(), updatedBy: interaction.user.id } }
    );
    await interaction.editReply({
        content: [
            "Wordle settings updated.",
            `Automatic challenges: **${(changes.automaticEnabled ?? settings.automaticEnabled) ? "enabled" : "disabled"}**`,
            `Rewards (5/6/7 letters): **${formatNumber(rewards[5])} / ${formatNumber(rewards[6])} / ${formatNumber(rewards[7])} MARK**`,
            `Length distribution (5/6/7): **${(changes.wordLengthDistribution || settings.wordLengthDistribution)[5]}% / ${(changes.wordLengthDistribution || settings.wordLengthDistribution)[6]}% / ${(changes.wordLengthDistribution || settings.wordLengthDistribution)[7]}%**`
        ].join("\n")
    });
}

async function recoverWordleChallenges(client) {
    const { settings, challenges } = collections();
    const guildSettings = await settings.find({ channelId: { $type: "string" } }).toArray();
    for (const config of guildSettings) {
        try {
            const active = await ensureActiveChallenge(config.guildId);
            if (active) {
                if (active.originalMessageId) {
                    const channel = await client.channels.fetch(active.channelId).catch(() => null);
                    if (channel?.isTextBased()) {
                        try {
                            await channel.messages.fetch(active.originalMessageId);
                        } catch {
                            await challenges.updateOne(
                                { challengeId: active.challengeId, status: "active" },
                                { $unset: { originalMessageId: "" } }
                            );
                            delete active.originalMessageId;
                        }
                    }
                }
                await publishChallenge(client, active);
            }
        } catch (error) {
            console.error("Wordle challenge recovery failed:", {
                guildId: config.guildId,
                code: error.code || error.name
            });
        }
    }
    await retryPendingPayments(client);
}

async function recoverUnpublishedChallenges(client) {
    const active = await collections().challenges.find({ status: "active" })
        .sort({ publishErrorAt: 1, startedAt: 1 }).limit(100).toArray();
    for (const challenge of active) {
        const correctPlayers = await collections().players.find({
            challengeId: challenge.challengeId,
            status: "playing",
            "guesses.guess": challenge.word
        }).toArray();
        const correctGuesses = correctPlayers.map(player => ({
            player,
            guess: player.guesses.find(item => item.guess === challenge.word)
        })).sort((left, right) => left.guess.createdAt - right.guess.createdAt);
        if (correctGuesses.length) {
            try {
                const { player, guess } = correctGuesses[0];
                await settleWinner(
                    client,
                    challenge,
                    player.userId,
                    player.guesses.findIndex(item => item === guess) + 1
                );
            } catch (error) {
                console.error("Wordle correct-guess recovery failed:", {
                    guildId: challenge.guildId,
                    challengeId: challenge.challengeId,
                    code: error.code || error.name
                });
            }
        }
        if (challenge.originalMessageId) continue;
        try {
            await publishChallenge(client, challenge);
        } catch (error) {
            console.error("Wordle unpublished challenge retry failed:", {
                guildId: challenge.guildId,
                challengeId: challenge.challengeId,
                code: error.code || error.name
            });
        }
    }
    await retryPendingPayments(client);
}

function startWordleScheduler(client) {
    const recover = () => recoverWordleChallenges(client).catch(error => {
        console.error("Wordle recovery scheduler failed:", {
            code: error.code || error.name
        });
    });
    recover();
    const timer = setInterval(() => {
        recoverUnpublishedChallenges(client).catch(error => {
            console.error("Wordle retry scheduler failed:", {
                code: error.code || error.name
            });
        });
    }, 60_000);
    timer.unref();
}

async function executeWordleCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await requireGuild(interaction);
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    if (group === "admin" && subcommand === "user") {
        return toggleWordleAdmin(interaction, interaction.options.getUser("user", true));
    }
    if (group === "admin" && subcommand === "stats") {
        await requireWordleAdmin(interaction);
        return showAdminStats(interaction);
    }

    switch (subcommand) {
        case "create":
        case "queue-add": {
            await requireWordleAdmin(interaction);
            const challenge = await enqueueCustomChallenge({
                guildId: interaction.guildId,
                word: interaction.options.getString("word", true),
                reward: interaction.options.getInteger("reward", true),
                title: interaction.options.getString("title"),
                maxAttempts: interaction.options.getInteger("attempts"),
                createdBy: interaction.user.id
            });
            await activateNextChallenge(interaction.client, interaction.guildId);
            const current = await collections().challenges.findOne({ challengeId: challenge.challengeId });
            const state = current?.status === "active" ? "activated" : "added to the queue";
            return interaction.editReply({
                content: `Custom Wordle #${challengeNumber(challenge)} was ${state}. The answer is hidden from the public.`
            });
        }
        case "queue":
            await requireWordleAdmin(interaction);
            return showQueue(interaction);
        case "queue-remove":
            await requireWordleAdmin(interaction);
            await removeQueuedChallenge(interaction.guildId, interaction.options.getString("id", true));
            return interaction.editReply({ content: "The pending challenge was removed and queue positions were updated." });
        case "queue-move":
            await requireWordleAdmin(interaction);
            await reorderChallenge(
                interaction.guildId,
                interaction.options.getString("id", true),
                interaction.options.getInteger("position", true)
            );
            return interaction.editReply({ content: "The challenge was moved and queue positions were updated." });
        case "queue-edit":
            await requireWordleAdmin(interaction);
            await editQueuedChallenge(interaction.guildId, interaction.options.getString("id", true), {
                word: interaction.options.getString("word"),
                title: interaction.options.getString("title"),
                reward: interaction.options.getInteger("reward")
            }, interaction.user.id);
            return interaction.editReply({ content: "The pending challenge was updated." });
        case "queue-clear": {
            await requireWordleAdmin(interaction);
            const result = await collections().challenges.deleteMany({ guildId: interaction.guildId, status: "queued" });
            return interaction.editReply({ content: `Removed ${result.deletedCount} pending challenge(s). The active challenge was not changed.` });
        }
        case "active": {
            const active = await collections().challenges.findOne({ guildId: interaction.guildId, status: "active" });
            if (!active) return interaction.editReply({ content: "There is no active Wordle challenge." });
            return interaction.editReply({
                embeds: [createEmbed(`Active Wordle #${challengeNumber(active)}`)
                    .setDescription(`${active.title || `${active.type} challenge`} • ${active.word.length} letters • ${active.maxAttempts} attempts • ${formatNumber(active.reward)} MARK`)
                    .setFooter({ text: "The answer remains secret." })]
            });
        }
        case "skip":
        case "end":
            await requireWordleAdmin(interaction);
            return completeChallenge(interaction.client, interaction, subcommand === "skip" ? "skipped" : "cancelled");
        case "reveal":
            await requireWordleAdmin(interaction);
            return revealChallenge(interaction.client, interaction);
        case "set-channel":
            return setWordleChannel(interaction, interaction.options.getChannel("channel", true));
        case "settings":
            return updateWordleSettings(interaction);
        case "stats":
            return personalStats(interaction);
        case "leaderboard":
            return showLeaderboard(interaction, interaction.options.getString("category") || "wins");
        case "history":
            return showHistory(interaction);
        default:
            throw new UserFacingError("That Wordle command is not supported.");
    }
}

module.exports = {
    COLLECTIONS,
    defaultSettings,
    getSettings,
    initializeWordleStorage,
    enqueueCustomChallenge,
    ensureActiveChallenge,
    activateNextChallenge,
    handleGuessMessage,
    registerWordleMessageEvents,
    recoverWordleChallenges,
    startWordleScheduler,
    executeWordleCommand
};
