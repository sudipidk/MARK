const { UserFacingError } = require("./errors");
const economy = require("./economy");
const {
    assertGuildInteraction,
    assertCoinAmount,
    formatCoins,
    formatDuration,
    getTitleAwareDisplayName,
    sanitizeDisplayText
} = require("./economy-format");

function privateReply(content) {
    return { content, ephemeral: true, allowedMentions: { parse: [] } };
}

function publicReply(content) {
    return { content, allowedMentions: { parse: [] } };
}

async function sendReply(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
        const { ephemeral, ...message } = payload;
        await interaction.editReply(message);
        return;
    }
    await interaction.reply(payload);
}

function defer(handler, ephemeral) {
    return async interaction => {
        assertGuildInteraction(interaction);
        await interaction.deferReply({
            ephemeral: typeof ephemeral === "function" ? ephemeral(interaction) : ephemeral
        });
        await economy.ensureAccount(interaction.guildId, interaction.user.id);
        return handler(interaction);
    };
}

async function getMember(guild, user) {
    if (!user || user.bot) throw new UserFacingError("That member cannot use this economy action.");
    try {
        return guild.members.cache.get(user.id) || await guild.members.fetch(user.id);
    } catch (error) {
        if (error.code === 10007) throw new UserFacingError("That user is not a member of this server.");
        throw error;
    }
}

async function getCurrentMember(guild, userId) {
    const cachedMember = guild.members.cache.get(userId);
    if (cachedMember) return cachedMember;
    try {
        return await guild.members.fetch(userId);
    } catch (error) {
        if (error.code === 10007) return null;
        throw error;
    }
}

async function selectedMember(interaction, optionName = "user") {
    const user = interaction.options.getUser(optionName) || interaction.user;
    const member = await getMember(interaction.guild, user);
    return { user, member };
}

async function displayName(guildId, user, member) {
    return getTitleAwareDisplayName(guildId, user, member);
}

async function getUserName(client, guild, userId) {
    const member = await getCurrentMember(guild, userId);
    if (member) return displayName(guild.id, member.user, member);
    const user = client.users.cache.get(userId) || await client.users.fetch(userId);
    return sanitizeDisplayText(user.username || user.globalName || "Former member");
}

async function executeBalance(interaction) {
    assertGuildInteraction(interaction);
    const { user, member } = await selectedMember(interaction);
    const account = await economy.getAccount(interaction.guildId, user.id);
    const name = await displayName(interaction.guildId, user, member);
    await sendReply(interaction, publicReply(`**${name}** has **${formatCoins(account.wallet)}**.\nUse \`/profile\` to see public economy stats.`));
}

async function executeReward(interaction, kind) {
    assertGuildInteraction(interaction);
    const result = kind === "work"
        ? await economy.claimWork({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            operationId: interaction.id
        })
        : kind === "beg"
            ? await economy.claimBeg({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                operationId: interaction.id
            })
            : await economy.claimReward({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                operationId: interaction.id,
                kind
            });

    if (kind === "beg") {
        const message = result.succeeded
            ? `Someone helped you out: **+${formatCoins(result.reward)}**. Balance: **${formatCoins(result.balance)}**.`
            : `No one helped this time. Your cooldown is active until <t:${Math.floor(result.nextAt.getTime() / 1000)}:R>.`;
        await sendReply(interaction, privateReply(message));
        return;
    }
    const message = kind === "work"
        ? `You ${result.job} and earned **${formatCoins(result.reward)}**. Balance: **${formatCoins(result.balance)}**.`
        : `You claimed **${formatCoins(result.reward)}**. Balance: **${formatCoins(result.balance)}**.`;
    await sendReply(interaction, privateReply(`${message}\nNext claim: <t:${Math.floor(result.nextAt.getTime() / 1000)}:R>.`));
}

async function executeGive(interaction) {
    assertGuildInteraction(interaction);
    const targetUser = interaction.options.getUser("user");
    const target = await getMember(interaction.guild, targetUser);
    const amount = assertCoinAmount(interaction.options.getInteger("amount"));
    if (target.user.id === interaction.user.id) throw new UserFacingError("You cannot transfer coins to yourself.");
    const result = await economy.transfer({
        guildId: interaction.guildId,
        fromUserId: interaction.user.id,
        toUserId: target.user.id,
        amount,
        operationId: interaction.id
    });
    const targetName = await displayName(interaction.guildId, target.user, target);
    await sendReply(interaction, privateReply(`Transferred **${formatCoins(result.amount)}** to **${targetName}**. Your balance is **${formatCoins(result.balance)}**.`));
}

async function executeSteal(interaction) {
    assertGuildInteraction(interaction);
    const targetUser = interaction.options.getUser("user");
    const target = await getMember(interaction.guild, targetUser);
    if (target.user.id === interaction.user.id) throw new UserFacingError("You cannot steal from yourself.");
    const result = await economy.steal({
        guildId: interaction.guildId,
        thiefId: interaction.user.id,
        targetId: target.user.id,
        operationId: interaction.id
    });
    const targetName = await displayName(interaction.guildId, target.user, target);

    try {
        const notice = result.succeeded
            ? `Someone stole ${formatCoins(result.amount)} from your wallet in ${interaction.guild.name}.`
            : `A failed steal attempt cost you ${formatCoins(result.amount)} in ${interaction.guild.name}.`;
        await target.user.send({ content: notice, allowedMentions: { parse: [] } });
    } catch (error) {
        console.error("Economy victim notification failed:", {
            guildId: interaction.guildId,
            userId: target.user.id,
            code: error.code || error.name
        });
    }

    const message = result.succeeded
        ? `You stole **${formatCoins(result.amount)}** from **${targetName}**. Your balance is **${formatCoins(result.thiefBalance)}**.`
        : `You were caught. **${formatCoins(result.amount)}** (25% of your pre-fine wallet) was paid to **${targetName}**. Your balance is **${formatCoins(result.thiefBalance)}**.`;
    await sendReply(interaction, privateReply(message));
}

async function executeCoinflip(interaction) {
    assertGuildInteraction(interaction);
    const stake = assertCoinAmount(interaction.options.getInteger("amount"), "Stake");
    const result = await economy.coinflip({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        stake,
        operationId: interaction.id
    });
    const outcome = result.won
        ? `You won **${formatCoins(result.payout)}** (net **+${formatCoins(result.net)}**).`
        : `You lost **${formatCoins(result.stake)}**.`;
    await sendReply(interaction, privateReply(
        `${outcome} Win chance: **${result.winPercent}%**. Balance: **${formatCoins(result.balance)}**.`
    ));
}

async function executeLottery(interaction) {
    assertGuildInteraction(interaction);
    const result = await economy.enterLottery({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        operationId: interaction.id
    });
    const entered = result.entered ? `Your ticket was purchased for **${formatCoins(result.ticketPrice)}**.` : "You already have a ticket for this round.";
    await sendReply(interaction, privateReply(
        `${entered}\nPrize pool: **${formatCoins(result.prizePool)}** · Participants: **${result.participants}** · Draw: <t:${Math.floor(result.endAt.getTime() / 1000)}:R>.`
    ));
}

async function executeRichest(interaction) {
    assertGuildInteraction(interaction);
    const accounts = await economy.getRichest(interaction.guildId);
    const rows = [];
    for (const account of accounts) {
        const member = await getCurrentMember(interaction.guild, account.userId);
        if (!member || member.user.bot) continue;
        const name = await displayName(interaction.guildId, member.user, member);
        rows.push(`${rows.length + 1}. **${name}** — ${formatCoins(account.wallet)}`);
    }
    await sendReply(interaction, publicReply(`**Richest members**\n${rows.join("\n") || "No economy accounts yet."}`));
}

async function executeProfile(interaction) {
    assertGuildInteraction(interaction);
    const { user, member } = await selectedMember(interaction);
    const profile = await economy.getProfile(interaction.guildId, user.id);
    const stats = profile.account.stats || {};
    const titleNames = profile.inventory.titles.map(owned =>
        `${owned.item?.name || "Unknown"}${owned.variantCode ? ` (${owned.variantCode})` : ""}`
    );
    const itemNames = profile.inventory.items.map(record =>
        `${record.item?.name || record.itemId} × ${record.quantity}`
    );
    const boostNames = [];
    if (profile.boosts.luckI) boostNames.push(`Luck I until <t:${Math.floor(profile.boosts.luckI.getTime() / 1000)}:R>`);
    if (profile.boosts.luckII) boostNames.push(`Luck II until <t:${Math.floor(profile.boosts.luckII.getTime() / 1000)}:R>`);
    const name = await displayName(interaction.guildId, user, member);
    const rarity = Object.entries(profile.rarityCounts).map(([key, value]) => `${key}: ${value}`).join(", ") || "None";
    await sendReply(interaction, publicReply([
        `**${name}'s economy profile**`,
        `Wallet: **${formatCoins(profile.account.wallet)}**`,
        `Titles (${profile.titleCompletion}% collection): ${titleNames.join(", ") || "None"}${profile.inventory.hasMoreTitles ? " · more in /inventory" : ""}`,
        `Title rarities: ${rarity}`,
        `Inventory: ${itemNames.join(", ") || "Empty"}`,
        `Active boosts: ${boostNames.join(", ") || "None"} · Bodyguards: ${profile.boosts.guards.length}`,
        `Earned: ${formatCoins(stats.totalEarned)} · Spent: ${formatCoins(stats.totalSpent)}`,
        `Gambling wins/losses: ${stats.gamblingWins || 0}/${stats.gamblingLosses || 0}`,
        `Successful/failed steals: ${stats.successfulSteals || 0}/${stats.failedSteals || 0}`,
        `Steal fines paid/received: ${formatCoins(stats.stealFinesPaid)} / ${formatCoins(stats.stealFinesReceived)}`
    ].join("\n")));
}

async function executeEconomyStats(interaction) {
    assertGuildInteraction(interaction);
    const stats = await economy.getEconomyStats(interaction.guildId);
    const richestAccounts = await economy.getRichest(interaction.guildId, 10);
    let richestName = "None yet";
    for (const account of richestAccounts) {
        const member = await getCurrentMember(interaction.guild, account.userId);
        if (!member || member.user.bot) continue;
        richestName = await displayName(interaction.guildId, member.user, member);
        break;
    }
    await sendReply(interaction, publicReply([
        "**Server economy**",
        `Coins in circulation: **${formatCoins(stats.circulation)}**`,
        `Accounts: **${stats.accounts}** · Richest: **${richestName}**`,
        `Coins issued (starting grants, rewards, and net coinflip wins): **${formatCoins(stats.issued)}**`,
        `Coins removed from circulation (shop/lottery/coinflip outflows, net of eligible returns): **${formatCoins(stats.removed)}**`,
        `Shop purchases/sales: **${stats.shopPurchases}/${stats.shopSales}**`,
        `Lottery entries: **${stats.lotteryEntries}**`,
        `Coinflip wins/losses: **${stats.gamblingWins}/${stats.gamblingLosses}**`
    ].join("\n")));
}

async function executeTransactions(interaction) {
    assertGuildInteraction(interaction);
    const page = interaction.options.getInteger("page") || 1;
    const transactions = await economy.listTransactions(interaction.guildId, interaction.user.id, (page - 1) * 10, 10);
    const rows = [];
    for (const transaction of transactions) {
        const counterparty = transaction.counterpartyUserId
            ? ` · with ${await getUserName(interaction.client, interaction.guild, transaction.counterpartyUserId)}`
            : "";
        const item = transaction.relatedItemId
            ? ` · ${economy.getCatalogItem(transaction.relatedItemId)?.name || "Item"}`
            : transaction.metadata?.roundId ? ` · round ${transaction.metadata.roundId}` : "";
        const date = Math.floor(new Date(transaction.createdAt).getTime() / 1000);
        let sign = "+";
        if (["transfer", "steal_fine", "steal_victim", "lottery_entry", "shop_purchase"]
            .includes(transaction.type)) {
            sign = "-";
        } else if (["steal", "transfer_received", "steal_fine_received"].includes(transaction.type)) {
            sign = "+";
        } else if (transaction.type === "coinflip") {
            sign = transaction.outcome === "win" ? "+" : "-";
        }
        const amount = transaction.type === "coinflip"
            ? transaction.metadata?.net ?? transaction.amount
            : transaction.amount;
        const signedAmount = `${sign}${formatCoins(Math.abs(amount))}`;
        rows.push(`• **${transaction.type.replace(/_/g, " ")}** ${signedAmount} · ${transaction.outcome} · <t:${date}:R>${counterparty}${item}`);
    }
    await sendReply(interaction, privateReply(
        `**Your transactions · page ${page}**\n${rows.join("\n") || "No transactions on this page."}`
    ));
}

async function executeCooldowns(interaction) {
    assertGuildInteraction(interaction);
    const cooldowns = await economy.getCooldowns(interaction.guildId, interaction.user.id);
    await sendReply(interaction, privateReply(`**Your cooldowns**\n${cooldowns.map(item =>
        `/${item.action}: ${item.remainingMs ? formatDuration(item.remainingMs) : "Ready"}`
    ).join("\n")}`));
}

function stockLabel(stock, item) {
    return item.weeklyStock
        ? `Stock: ${stock?.available ?? item.weeklyStock} left this week`
        : "Unlimited stock";
}

async function executeShop(interaction) {
    assertGuildInteraction(interaction);
    const action = interaction.options.getSubcommand();
    if (action === "buy" || action === "sell") {
        const itemInput = interaction.options.getString("item");
        const quantity = interaction.options.getInteger("quantity") || 1;
        const result = action === "buy"
            ? await economy.buyItem({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                itemInput,
                quantity,
                operationId: interaction.id
            })
            : await economy.sellItem({
                guildId: interaction.guildId,
                userId: interaction.user.id,
                itemInput,
                quantity,
                operationId: interaction.id
            });
        const label = action === "buy"
            ? `Purchased ${quantity} × **${result.item.name}** for **${formatCoins(result.total)}**.`
            : `Sold ${quantity} × **${result.item.name}** for **${formatCoins(result.payout)}**.`;
        await sendReply(interaction, privateReply(`${label}\nBalance: **${formatCoins(result.balance)}**${result.variantCode ? ` · Variant code: **${result.variantCode}**` : ""}`));
        return;
    }
    await economy.getAccount(interaction.guildId, interaction.user.id);
    const listings = await economy.listShop(interaction.guildId, interaction.user.id);
    const category = action === "titles" ? "title" : action === "consumables" ? "consumable" : null;
    const filtered = listings.filter(entry => !category || entry.item.category === category);
    const lines = filtered.map(({ item, owned, stock }) => {
        const details = item.category === "title"
            ? `${item.rarity}${item.weeklyStock ? " · Weekly limited" : ""}${owned ? " · Owned" : ""} · ${item.resalePrice ? `Resale: ${formatCoins(item.resalePrice)}` : "Not sellable"} · ${stockLabel(stock, item)}`
            : `${item.effect} · Resale: ${formatCoins(item.resalePrice)}`;
        return `• **${item.name}** — ${formatCoins(item.price)} · ${details}`;
    });
    const title = action === "titles" ? "Shop · titles" : action === "consumables" ? "Shop · consumables" : "Shop";
    await sendReply(interaction, publicReply(`**${title}**\n${lines.join("\n")}`));
}

async function executeItem(interaction) {
    assertGuildInteraction(interaction);
    const item = economy.getCatalogItem(interaction.options.getString("item"));
    if (!item) throw new UserFacingError("That catalog item does not exist.");
    const stock = item.weeklyStock ? await economy.getLimitedStock(interaction.guildId, item) : null;
    await economy.ensureAccount(interaction.guildId, interaction.user.id);
    const owns = await economy.ownsItem(interaction.guildId, interaction.user.id, item);
    await sendReply(interaction, publicReply([
        `**${item.name}** — ${item.category} · ${item.rarity}`,
        item.description,
        `Price: ${formatCoins(item.price)} · Resale: ${item.resalePrice ? formatCoins(item.resalePrice) : "Not sellable"}`,
        `Duration: ${item.durationMs ? formatDuration(item.durationMs) : "Permanent"}`,
        `Effect: ${item.effect || "Cosmetic title only"}`,
        `Limited status: ${item.weeklyStock ? `Weekly (${item.weeklyStock}) · ${stockLabel(stock, item)}` : "Not limited"}`,
        `Ownership: ${owns ? (item.category === "title" ? "Owned" : `${owns.quantity} in inventory`) : "Not owned"}`
    ].join("\n")));
}

async function executeInventory(interaction) {
    assertGuildInteraction(interaction);
    const { user, member } = await selectedMember(interaction);
    const page = interaction.options.getInteger("page") || 1;
    const inventory = await economy.getInventory(interaction.guildId, user.id, page);
    const titleLines = inventory.titles.map(owned =>
        `• ${owned.item?.name || "Unknown"}${owned.variantCode ? ` (${owned.variantCode})` : ""} · ${owned.item?.rarity || "Unknown"} · ${owned.item?.sellable ? "sellable" : "not sellable"} · equipable${inventory.equippedTitleId === owned.titleId && (!owned.variantCode || inventory.equippedVariantCode === owned.variantCode) ? " · equipped" : ""}`
    );
    const itemLines = inventory.items.map(record =>
        `• ${record.item?.name || record.itemId} × ${record.quantity} · ${record.item?.sellable ? "sellable" : "not sellable"} · usable`
    );
    const effectLines = inventory.effects.map(effect =>
        `• ${effect.item?.name || effect.effectType} active until <t:${Math.floor(effect.expiresAt.getTime() / 1000)}:R>`
    );
    const name = await displayName(interaction.guildId, user, member);
    await sendReply(interaction, publicReply([
        `**${name}'s inventory · page ${page}**`,
        `Titles: ${titleLines.join("\n") || "None"}`,
        `Unused items: ${itemLines.join("\n") || "None"}`,
        `Active effects: ${effectLines.join("\n") || "None"}`,
        inventory.hasMoreTitles || inventory.hasMoreItems ? `More results: \`/inventory page ${page + 1}\`` : ""
    ].join("\n")));
}

async function executeUse(interaction) {
    assertGuildInteraction(interaction);
    const result = await economy.useItem({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        itemInput: interaction.options.getString("item"),
        quantity: interaction.options.getInteger("quantity") || 1,
        operationId: interaction.id
    });
    await sendReply(interaction, privateReply(
        `Activated **${result.item.name}** × ${result.quantity}. Expires <t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>.`
    ));
}

async function executeBoosts(interaction) {
    assertGuildInteraction(interaction);
    const boosts = await economy.getBoosts(interaction.guildId, interaction.user.id);
    const lines = [
        `Coinflip Luck I: ${boosts.luckI ? `until <t:${Math.floor(boosts.luckI.getTime() / 1000)}:R>` : "Inactive"}`,
        `Coinflip Luck II: ${boosts.luckII ? `until <t:${Math.floor(boosts.luckII.getTime() / 1000)}:R>` : "Inactive"}`,
        `Effective coinflip win chance: **${boosts.effectiveCoinflipPercent}%**`,
        `Active bodyguards: **${boosts.guards.length}**`
    ];
    boosts.guards.forEach((expiresAt, index) =>
        lines.push(`Guard ${index + 1}: until <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`));
    if (boosts.nextGuardChange) {
        lines.push(`Next protection change: <t:${Math.floor(boosts.nextGuardChange.getTime() / 1000)}:R>`);
    }
    await sendReply(interaction, privateReply(`**Active boosts**\n${lines.join("\n")}`));
}

async function executeTitles(interaction) {
    assertGuildInteraction(interaction);
    const action = interaction.options.getSubcommand();
    if (action === "use") {
        const result = await economy.equipTitle({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            titleInput: interaction.options.getString("title"),
            operationId: interaction.id
        });
        await sendReply(interaction, privateReply(
            `Equipped **${result.title.name}${result.variantCode ? ` ${result.variantCode}` : ""}**.`
        ));
        return;
    }
    const page = interaction.options.getInteger("page") || 1;
    const inventory = await economy.getInventory(interaction.guildId, interaction.user.id, page);
    const account = await economy.getAccount(interaction.guildId, interaction.user.id);
    const rows = inventory.titles.map(owned => {
        const item = owned.item;
        const code = owned.variantCode ? ` (${owned.variantCode})` : "";
        const equipped = account.equippedTitleId === owned.titleId &&
            (!owned.variantCode || account.equippedVariantCode === owned.variantCode)
            ? " · Equipped"
            : "";
        return `• **${item?.name || "Unknown"}**${code} · ${item?.rarity || "Unknown"} · ${item?.weeklyStock ? "Limited, not sellable" : "Permanent"}${equipped}`;
    });
    await sendReply(interaction, publicReply(`**Your titles · page ${page}**\n${rows.join("\n") || "You do not own any titles yet."}${inventory.hasMoreTitles ? `\nMore: \`/titles list page ${page + 1}\`` : ""}`));
}

async function executeAvatarDisplayName(interaction, user, member) {
    return displayName(interaction.guildId, user, member);
}

module.exports = {
    executeBalance: defer(executeBalance, false),
    executeReward: (interaction, kind) => {
        const handler = async current => executeReward(current, kind);
        return defer(handler, true)(interaction);
    },
    executeGive: defer(executeGive, true),
    executeSteal: defer(executeSteal, true),
    executeCoinflip: defer(executeCoinflip, true),
    executeLottery: defer(executeLottery, true),
    executeRichest: defer(executeRichest, false),
    executeProfile: defer(executeProfile, false),
    executeEconomyStats: defer(executeEconomyStats, false),
    executeTransactions: defer(executeTransactions, true),
    executeCooldowns: defer(executeCooldowns, true),
    executeShop: defer(executeShop, interaction => ["buy", "sell"].includes(interaction.options.getSubcommand())),
    executeItem: defer(executeItem, false),
    executeInventory: defer(executeInventory, false),
    executeUse: defer(executeUse, true),
    executeBoosts: defer(executeBoosts, true),
    executeTitles: defer(executeTitles, interaction => interaction.options.getSubcommand() === "use"),
    executeAvatarDisplayName
};
