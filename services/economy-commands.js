const { UserFacingError } = require("./errors");
const economy = require("./economy");
const {
    assertGuildInteraction,
    formatCoins,
    parseCompactCurrencyInput,
    formatDuration,
    getTitleAwareDisplayName,
    sanitizeDisplayText
} = require("./economy-format");
const { COLORS, createEconomyEmbed, economyReply } = require("./economy-embeds");
const ECONOMY_ADMIN_ID = "1262703637579305063";

function privateReply(content) {
    return { ...economyReply("Your private economy information", content), ephemeral: true };
}

function publicReply(content, title = "MARK Economy") {
    return economyReply(title, content);
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
    let user = client.users.cache.get(userId);
    if (!user) {
        try {
            user = await client.users.fetch(userId);
        } catch (error) {
            if (error.code === 10013) return "Former member";
            throw error;
        }
    }
    return sanitizeDisplayText(user.username || user.globalName || "Former member");
}

async function executeBalance(interaction) {
    assertGuildInteraction(interaction);
    const { user, member } = await selectedMember(interaction);
    const account = await economy.getAccount(interaction.guildId, user.id);
    const bank = await economy.getBankSummary(interaction.guildId, user.id);
    const name = await displayName(interaction.guildId, user, member);
    const title = economy.getCatalogItem(account.equippedTitleId);
    await sendReply(interaction, economyReply("Wallet balance", "Global balance shared across MARK servers.", {
        author: name,
        avatarURL: member.displayAvatarURL(),
        fields: [
            { name: "Wallet", value: `**${formatCoins(account.wallet)}**`, inline: true },
            { name: "Bank", value: `**${formatCoins(bank.balance)}**`, inline: true },
            { name: "Combined wealth", value: `**${formatCoins(bank.combinedWealth)}**`, inline: true },
            {
                name: "Equipped title",
                value: title
                    ? `${title.name}${account.equippedVariantCode ? ` ${account.equippedVariantCode}` : ""} · ${title.rarity}`
                    : "None"
            }
        ]
    }));
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
        await sendReply(interaction, publicReply(message, result.succeeded ? "Begging success" : "Begging failed"));
        return;
    }
    const message = kind === "work"
        ? `You ${result.job} and earned **${formatCoins(result.reward)}**. Balance: **${formatCoins(result.balance)}**.`
        : `You claimed **${formatCoins(result.reward)}**. Balance: **${formatCoins(result.balance)}**.`;
    await sendReply(interaction, publicReply(`${message}\nNext claim: <t:${Math.floor(result.nextAt.getTime() / 1000)}:R>.`, kind === "work" ? "Work reward" : "Daily reward"));
}

async function executeGive(interaction) {
    assertGuildInteraction(interaction);
    const targetUser = interaction.options.getUser("user");
    const target = await getMember(interaction.guild, targetUser);
    const amount = readCurrencyAmount(interaction, "Transfer amount");
    if (target.user.id === interaction.user.id) throw new UserFacingError("You cannot transfer coins to yourself.");
    const result = await economy.transfer({
        guildId: interaction.guildId,
        fromUserId: interaction.user.id,
        toUserId: target.user.id,
        amount,
        operationId: interaction.id
    });
    const targetName = await displayName(interaction.guildId, target.user, target);
    await sendReply(interaction, publicReply(`Transferred **${formatCoins(result.amount)}** to **${targetName}**. Your balance is **${formatCoins(result.balance)}**.`, "Coins transferred"));
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
    await sendReply(interaction, publicReply(message, result.succeeded ? "Steal successful" : "Steal failed"));
}

async function executeCoinflip(interaction) {
    assertGuildInteraction(interaction);
    const stake = readCurrencyAmount(interaction, "Stake");
    const choice = interaction.options.getString("choice");
    const result = await economy.coinflip({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        stake,
        choice,
        operationId: interaction.id
    });
    await sendReply(interaction, economyReply(
        result.won ? "Coinflip won" : "Coinflip lost",
        `${result.won
            ? `Payout: **${formatCoins(result.payout)}** (net +${formatCoins(result.net)}).`
            : `Loss: **${formatCoins(result.stake)}**.`}`,
        {
            color: result.won ? COLORS.success : COLORS.error,
            fields: [
                { name: "Your choice", value: choice === "heads" ? "Heads" : "Tails", inline: true },
                { name: "Result", value: result.result === "heads" ? "Heads" : "Tails", inline: true },
                { name: "Wager", value: formatCoins(result.stake), inline: true },
                { name: "Win chance", value: `${result.winPercent}%${result.luckItem ? ` · ${economy.getCatalogItem(result.luckItem).name} active` : ""}`, inline: true },
                { name: "Wallet", value: formatCoins(result.balance), inline: true }
            ]
        }
    ));
}

async function executeLottery(interaction) {
    assertGuildInteraction(interaction);
    const amount = readCurrencyAmount(interaction, "Lottery wager");
    const result = await economy.playNumberLottery({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        number: interaction.options.getInteger("number"),
        amount,
        operationId: interaction.id
    });
    const winnings = result.won
        ? `You matched prize number ${result.winningNumbers.indexOf(result.number) + 1}; payout: **${formatCoins(result.payout)}** (${result.multiplier}×), net **+${formatCoins(result.net)}**.`
        : `No match. You lost **${formatCoins(result.amount)}**.`;
    await sendReply(interaction, economyReply(
        result.won ? "Lottery won" : "Lottery lost",
        winnings,
        {
            color: result.won ? COLORS.success : COLORS.error,
            fields: [
                { name: "Your number", value: String(result.number), inline: true },
                { name: "Winning numbers", value: result.winningNumbers.join(", "), inline: true },
                { name: "Wager", value: formatCoins(result.amount), inline: true },
                { name: "Wallet", value: formatCoins(result.balance), inline: true }
            ]
        }
    ));
}

async function executeRichest(interaction) {
    assertGuildInteraction(interaction);
    const mode = interaction.options.getString?.("mode") || "combined";
    const accounts = await economy.getRichest(interaction.guildId, 10, mode);
    const rows = [];
    for (const account of accounts) {
        const name = await getUserName(interaction.client, interaction.guild, account.userId);
        rows.push(`${rows.length + 1}. **${name}** — ${formatCoins(account.leaderboardValue)} · Wallet ${formatCoins(account.wallet)} · Bank ${formatCoins(account.bankBalance)} · Combined ${formatCoins(account.combinedWealth)}`);
    }
    await sendReply(interaction, economyReply(`Global richest · ${mode}`, rows.join("\n") || "No economy accounts yet."));
}

async function executeProfile(interaction) {
    assertGuildInteraction(interaction);
    const { user, member } = await selectedMember(interaction);
    const profile = await economy.getProfile(interaction.guildId, user.id);
    const achievements = await economy.getAchievementSummary(interaction.guildId, user.id);
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
    const guardNames = profile.boosts.guards.map((expiresAt, index) =>
        `Guard ${index + 1} until <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
    );
    const name = await displayName(interaction.guildId, user, member);
    const rarity = Object.entries(profile.rarityCounts).map(([key, value]) => `${key}: ${value}`).join(", ") || "None";
    const equippedTitle = economy.getCatalogItem(profile.account.equippedTitleId);
    const achievementCatalog = require("./economy-achievements").getAchievementCatalog();
    const lockedProgress = achievementCatalog
        .filter(achievement => !achievements.unlocked.includes(achievement.id))
        .map(achievement => ({ achievement, progress: achievements.progress[achievement.id] }))
        .filter(entry => entry.progress)
        .sort((left, right) =>
            right.progress.percentage - left.progress.percentage ||
            (left.achievement.difficulty || 0) - (right.achievement.difficulty || 0) ||
            left.achievement.id.localeCompare(right.achievement.id)
        )
        .slice(0, 3)
        .map(entry => `${entry.achievement.name}: ${entry.progress.current.toLocaleString("en-US")}/${entry.progress.target.toLocaleString("en-US")}`);
    const completionBar = `[${"#".repeat(Math.round(achievements.completionPercent / 10))}${"-".repeat(10 - Math.round(achievements.completionPercent / 10))}]`;
    const hardest = achievements.strongest.map(achievement => achievement.name).join(", ") || "None earned yet";
    const recent = achievements.recent.map(achievement => achievement.name).join(", ") || "None yet";
    await sendReply(interaction, economyReply(`${name}'s global economy profile`, null, {
        author: name,
        avatarURL: member.displayAvatarURL(),
        fields: [
            { name: "Wallet", value: formatCoins(profile.account.wallet), inline: true },
            {
                name: "Equipped title",
                value: equippedTitle
                    ? `${equippedTitle.name}${profile.account.equippedVariantCode ? ` ${profile.account.equippedVariantCode}` : ""} · ${equippedTitle.rarity}`
                    : "None",
                inline: true
            },
            { name: `Titles · ${profile.titleCompletion}% collection`, value: `${titleNames.join(", ") || "None"}${profile.inventory.hasMoreTitles ? " · More in /inventory" : ""}` },
            { name: "Title rarities", value: rarity },
            { name: "Inventory", value: itemNames.join(", ") || "Empty" },
            { name: "Active boosts", value: boostNames.join(", ") || "None", inline: true },
            { name: "Active bodyguards", value: guardNames.join("\n") || "None", inline: true },
            { name: "Earnings / spending", value: `${formatCoins(stats.totalEarned)} / ${formatCoins(stats.totalSpent)}`, inline: true },
            { name: "Gambling wins / losses", value: `${stats.gamblingWins || 0} / ${stats.gamblingLosses || 0}`, inline: true },
            { name: "Successful / failed steals", value: `${stats.successfulSteals || 0} / ${stats.failedSteals || 0}`, inline: true },
            { name: "Steal fines paid / received", value: `${formatCoins(stats.stealFinesPaid)} / ${formatCoins(stats.stealFinesReceived)}` },
            { name: "Achievements", value: `${achievements.earnedCount}/${achievements.total} · ${achievements.completionPercent}% ${completionBar}\nRecently unlocked: ${recent}\nHardest earned: ${hardest}\nLocked progress: ${lockedProgress.join(" · ") || "All active achievements earned"}\nThe Dark Knight: ${achievements.completionTagUnlocked ? "unlocked" : "locked"}` }
        ]
    }));
}

async function executeEconomyStats(interaction) {
    assertGuildInteraction(interaction);
    const stats = await economy.getEconomyStats(interaction.guildId);
    const richestAccounts = await economy.getRichest(interaction.guildId, 10);
    const richestName = richestAccounts.length
        ? await getUserName(interaction.client, interaction.guild, richestAccounts[0].userId)
        : "None yet";
    await sendReply(interaction, publicReply([
        "**Global economy**",
        `Coins in circulation: **${formatCoins(stats.circulation)}**`,
        `Accounts: **${stats.accounts}** · Richest: **${richestName}**`,
        `Coins issued (starting grants, rewards, and net coinflip wins): **${formatCoins(stats.issued)}**`,
        `Coins removed from circulation (shop/lottery/coinflip outflows, net of eligible returns): **${formatCoins(stats.removed)}**`,
        `Shop purchases/sales: **${stats.shopPurchases}/${stats.shopSales}**`,
        `Lottery entries: **${stats.lotteryEntries}**`,
        `Coinflip wins/losses: **${stats.gamblingWins}/${stats.gamblingLosses}**`
    ].join("\n"), "Global economy statistics"));
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
    await sendReply(interaction, publicReply(cooldowns.map(item =>
        `/${item.action}: ${item.remainingMs ? formatDuration(item.remainingMs) : "Ready"}`
    ).join("\n"), "Your cooldowns"));
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
        await sendReply(interaction, publicReply(
            `${label}\nBalance: **${formatCoins(result.balance)}**${result.variantCode ? ` · Variant code: **${result.variantCode}**` : ""}`,
            action === "buy" ? "Shop purchase complete" : "Shop sale complete"
        ));
        return;
    }
    await economy.getAccount(interaction.guildId, interaction.user.id);
    const listings = await economy.listShop(interaction.guildId, interaction.user.id);
    const category = action === "titles" ? "title" : action === "consumables" ? "consumable" : null;
    const filtered = listings.filter(entry => !category || entry.item.category === category);
    const page = interaction.options.getInteger("page") || 1;
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > pageCount) throw new UserFacingError(`The shop has ${pageCount} page(s) in this category.`);
    const pageListings = filtered.slice((page - 1) * pageSize, page * pageSize);
    const grouped = [
        { title: "Boosts", items: pageListings.filter(({ item }) => item.id.startsWith("coinflip-luck-")) },
        { title: "Bodyguards", items: pageListings.filter(({ item }) => item.id === "bodyguard") },
        { title: "Titles", items: pageListings.filter(({ item }) => item.category === "title") }
    ];
    const fields = [];
    for (const group of grouped) {
        if (!group.items.length) continue;
        fields.push({ name: group.title, value: "\u200b" });
        for (const { item, owned, stock } of group.items) {
            const restrictions = [
                item.weeklyStock ? `Weekly limited · ${stockLabel(stock, item)}` : null,
                owned && item.category === "title" ? "Already owned" : null,
                item.sellable ? `Resale: ${formatCoins(item.resalePrice)}` : "Not sellable"
            ].filter(Boolean).join(" · ");
            fields.push({
                name: `${item.name} (${item.id})`,
                value: [
                    `**Price:** ${formatCoins(item.price)}`,
                    `**Ability:** ${item.description}`,
                    restrictions ? `**Restrictions:** ${restrictions}` : null,
                    `**Purchase:** \`/shop buy item:${item.id}${item.stackable ? " quantity:<N>" : ""}\``
                ].filter(Boolean).join("\n")
            });
        }
    }
    const title = "MARK Economy Shop";
    const description = `Purchase items and titles with your global wallet balance · page ${page}/${pageCount}.\nBrowse the listings, choose an item's ID, then use \`/shop buy item:<ID>\`; add optional \`quantity:<N>\` for stackable items. Selling uses \`/shop sell item:<ID>\`.`;
    await sendReply(interaction, {
        embeds: [createEconomyEmbed({ title, description, fields, footer: `Use /shop ${action} page:${Math.min(page + 1, pageCount)} for the next page.` })],
        allowedMentions: { parse: [] }
    });
}

async function executeItem(interaction) {
    assertGuildInteraction(interaction);
    const item = economy.getCatalogItem(interaction.options.getString("item"));
    if (!item) throw new UserFacingError("That catalog item does not exist.");
    const stock = item.weeklyStock ? await economy.getLimitedStock(interaction.guildId, item) : null;
    await economy.ensureAccount(interaction.guildId, interaction.user.id);
    const owns = await economy.ownsItem(interaction.guildId, interaction.user.id, item);
    await sendReply(interaction, economyReply(item.name, item.description, {
        fields: [
            { name: "ID", value: item.id, inline: true },
            { name: "Category / rarity", value: `${item.category} · ${item.rarity}`, inline: true },
            { name: "Price", value: formatCoins(item.price), inline: true },
            { name: "Ability", value: item.effect || "Cosmetic title only" },
            { name: "Duration", value: item.durationMs ? formatDuration(item.durationMs) : "Permanent", inline: true },
            { name: "Resale", value: item.resalePrice ? formatCoins(item.resalePrice) : "Not sellable", inline: true },
            { name: "Stock", value: item.weeklyStock ? `Weekly · ${stockLabel(stock, item)}` : "Unlimited", inline: true },
            { name: "Ownership", value: owns ? (item.category === "title" ? "Owned" : `${owns.quantity} in inventory`) : "Not owned", inline: true },
            { name: "Purchase", value: `Use \`/shop buy item:${item.id}${item.stackable ? " quantity:<N>" : ""}\`.` }
        ]
    }));
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
    await sendReply(interaction, economyReply(`${name}'s inventory · page ${page}`, null, {
        author: name,
        avatarURL: member.displayAvatarURL(),
        fields: [
            { name: "Titles", value: titleLines.join("\n") || "None" },
            { name: "Unused items", value: itemLines.join("\n") || "None" },
            { name: "Active effects", value: effectLines.join("\n") || "None" },
            ...(inventory.hasMoreTitles || inventory.hasMoreItems
                ? [{ name: "More", value: `Use \`/inventory page:${page + 1}\`.` }]
                : [])
        ]
    }));
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
    await sendReply(interaction, publicReply(
        `Activated **${result.item.name}** × ${result.quantity}. Expires <t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>.`,
        "Item activated"
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
    await sendReply(interaction, publicReply(lines.join("\n"), "Active boosts"));
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
        await sendReply(interaction, publicReply(
            `Equipped **${result.title.name}${result.variantCode ? ` ${result.variantCode}` : ""}**.`,
            "Title equipped"
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
    await sendReply(interaction, publicReply(
        `${rows.join("\n") || "You do not own any titles yet."}${inventory.hasMoreTitles ? `\nMore: \`/titles list page:${page + 1}\`` : ""}`,
        `Your titles · page ${page}`
    ));
}

async function executeBank(interaction) {
    assertGuildInteraction(interaction);
    const targetUser = interaction.options.getUser ? interaction.options.getUser("user") : null;
    const user = targetUser || interaction.user;
    const summary = await economy.getBankSummary(interaction.guildId, user.id);
    const isSelf = user.id === interaction.user.id;
    const label = isSelf ? "Your bank" : `${await getUserName(interaction.client, interaction.guild, user.id)}'s bank`;
    const fields = [
        { name: "Wallet", value: formatCoins(summary.wallet), inline: true },
        { name: "Bank balance", value: formatCoins(summary.balance), inline: true },
        { name: "Locked", value: formatCoins(summary.locked), inline: true },
        { name: "Unlocked", value: formatCoins(summary.unlocked), inline: true },
        { name: "Deposit count", value: `${summary.depositCount || 0}/10`, inline: true },
        { name: "Next unlock", value: summary.nextUnlockAt ? `<t:${Math.floor(new Date(summary.nextUnlockAt).getTime() / 1000)}:R>` : "None", inline: true },
        { name: "Deposit fees paid", value: formatCoins(summary.totalDepositFeesPaid), inline: true },
        { name: "Withdrawal fees paid", value: formatCoins(summary.totalWithdrawalFeesPaid), inline: true }
    ];
    await sendReply(interaction, economyReply(label, null, {
        author: isSelf ? "Your bank" : label,
        avatarURL: interaction.user.displayAvatarURL ? interaction.user.displayAvatarURL() : undefined,
        fields
    }));
}

async function executeDeposit(interaction) {
    assertGuildInteraction(interaction);
    const resolved = readCurrencyAmount(interaction, "Deposit amount");
    const token = interaction.options.getString("confirm");
    if (!token) {
        const preview = await economy.requestBankDeposit({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            amount: resolved
        });
        await sendReply(interaction, publicReply(
            `**Deposit preview**\nPrincipal: **${formatCoins(preview.amount)}**\nDeposit fee (2%, rounded down to whole coins): **${formatCoins(preview.fee)}**\nTotal wallet deduction: **${formatCoins(preview.totalDeduction)}**.\nThis creates a separate bank lot locked for 12 hours. Confirm within five minutes with \`/deposit amount:${resolved} confirm:${preview.token}\`.`,
            "Confirm bank deposit"
        ));
        return;
    }
    const result = await economy.confirmBankDeposit({
        userId: interaction.user.id,
        amount: resolved,
        token
    });
    await sendReply(interaction, publicReply(
        `Deposited **${formatCoins(result.principal)}** with a **${formatCoins(result.fee)}** fee. Total wallet deduction: **${formatCoins(result.totalDeduction)}**. Bank balance: **${formatCoins(result.bankBalance)}**. Unlocks <t:${Math.floor(new Date(result.unlockAt).getTime() / 1000)}:R>.`,
        "Bank deposit"
    ));
}

async function executeWithdraw(interaction) {
    assertGuildInteraction(interaction);
    const resolved = readCurrencyAmount(interaction, "Withdrawal amount");
    const result = await economy.withdrawFromBank({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        amount: resolved,
        operationId: interaction.id
    });
    await sendReply(interaction, publicReply(
        `Withdrew **${formatCoins(result.principal)}** from the bank. Fee: **${formatCoins(result.fee)}**. Net wallet credit: **${formatCoins(result.net)}**. Remaining bank balance: **${formatCoins(result.bankBalance)}**.`,
        "Bank withdrawal"
    ));
}

async function executeBankFunds(interaction) {
    assertGuildInteraction(interaction);
    const summary = await economy.getBankSummary(interaction.guildId, interaction.user.id);
    await sendReply(interaction, publicReply([
        `Total bank principal: **${formatCoins(summary.balance)}**`,
        `Locked principal: **${formatCoins(summary.locked)}**`,
        `Unlocked principal: **${formatCoins(summary.unlocked)}**`,
        `Total deposited: **${formatCoins(summary.totalDeposits)}** · Lots: **${summary.lots.length}**`,
        `Deposit/withdrawal fees paid: **${formatCoins(summary.totalDepositFeesPaid)} / ${formatCoins(summary.totalWithdrawalFeesPaid)}**`,
        summary.nextUnlockAt ? `Next unlock: <t:${Math.floor(new Date(summary.nextUnlockAt).getTime() / 1000)}:R>` : "No active bank deposits"
    ].join("\n"), "Bank funds"));
}

async function executeBankHistory(interaction) {
    assertGuildInteraction(interaction);
    const page = interaction.options.getInteger ? interaction.options.getInteger("page") || 1 : 1;
    const rows = await economy.listBankHistory(interaction.guildId, interaction.user.id, page, 8);
    const formatted = rows.length
        ? rows.map(entry => {
            const metadata = entry.metadata || {};
            const feeText = metadata.feeRecipientUserId
                ? ` · fee ${formatCoins(metadata.fee || 0)} to <@${metadata.feeRecipientUserId}>`
                : ` · fee ${formatCoins(metadata.fee || 0)}`;
            const details = entry.type === "bank_deposit"
                ? ` · lot ${metadata.lotId || "unknown"} · unlocks ${metadata.unlockAt ? `<t:${Math.floor(new Date(metadata.unlockAt).getTime() / 1000)}:R>` : "unknown"}`
                : ` · net wallet ${formatCoins(metadata.net || 0)}`;
            return `• **${entry.type.replace("bank_", "").replace(/_/g, " ")}** · principal ${formatCoins(entry.amount)}${feeText}${details} · <t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>`;
        }).join("\n")
        : "No bank transactions yet.";
    await sendReply(interaction, privateReply(`**Your bank history · page ${page}**\n${formatted}`));
}

async function executeAchievements(interaction) {
    assertGuildInteraction(interaction);
    const user = interaction.options.getUser ? interaction.options.getUser("user") || interaction.user : interaction.user;
    const summary = await economy.getAchievementSummary(interaction.guildId, user.id);
    const account = await economy.getAccount(interaction.guildId, user.id);
    const catalog = require("./economy-achievements").getAchievementCatalog();
    const unlocked = new Set(account?.achievements?.unlocked || []);
    const claimed = new Set(account?.achievements?.claimed || []);
    const page = interaction.options.getInteger?.("page") || 1;
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(catalog.length / pageSize));
    if (page > pageCount) throw new UserFacingError(`Achievements has ${pageCount} page(s).`);
    const achievements = catalog.slice((page - 1) * pageSize, page * pageSize);
    const lines = achievements.map(item => {
        const reward = [
            item.rewardCoins ? formatCoins(item.rewardCoins) : null,
            ...(item.rewardTags || [])
        ].filter(Boolean).join(" + ") || "No reward";
        const earned = unlocked.has(item.id);
        const rewardClaimed = claimed.has(item.id);
        const progress = summary.progress[item.id];
        const progressText = progress
            ? `Progress: ${progress.current.toLocaleString("en-US")}/${progress.target.toLocaleString("en-US")}`
            : "Progress: unavailable";
        const unlockedAt = account?.achievements?.unlockedAt?.[item.id];
        return `${earned ? "✅" : "⬜"} **${item.name}** · ${item.rarity}\n${item.description}\n${progressText} · Reward: ${reward} · ${earned ? (rewardClaimed ? "claimed" : "unclaimed") : "locked"}${unlockedAt ? ` · <t:${Math.floor(new Date(unlockedAt).getTime() / 1000)}:d>` : ""}`;
    });
    const darkKnight = (account?.achievements?.unlocked || []).includes("the-dark-knight");
    await sendReply(interaction, economyReply(
        `${user.username || "Player"} · Achievements`,
        `${summary.earnedCount}/${summary.total} unlocked · ${summary.completionPercent}% complete${darkKnight ? "\n**The Dark Knight** completion reward unlocked." : ""}\n\n${lines.join("\n\n") || "No achievements available."}`,
        { footer: `Page ${page}/${pageCount}` }
    ));
}

async function executeHelp(interaction) {
    assertGuildInteraction(interaction);
    const fs = require("node:fs");
    const path = require("node:path");
    const commandDir = path.join(__dirname, "../commands");
    const files = fs.readdirSync(commandDir).filter(file => file.endsWith(".js"));
    const groups = {
        UTILITY: [],
        ECONOMY: [],
        GAMBLING: [],
        "SHOP & COLLECTION": [],
        BANKING: [],
        ACHIEVEMENTS: [],
        "FUN & SOCIAL": [],
        OTHER: []
    };

    const categories = {
        utility: new Set(["afk", "avatar", "cooldown", "ping", "remind", "reminder", "reminders", "serverinfo", "uptime", "userinfo"]),
        economy: new Set(["bal", "beg", "daily", "economy", "give", "steal", "transactions", "weekly", "work"]),
        gambling: new Set(["cf", "lottery", "richest"]),
        collection: new Set(["boosts", "inventory", "item", "shop", "titles", "use"]),
        banking: new Set(["bank", "bankfunds", "deposit", "withdraw"]),
        achievements: new Set(["achievements", "profile"]),
        fun: new Set([
            "dnatest", "gaytest", "iqtest", "lovetest", "rizztest", "lucktest",
            "chatest", "charoll", "characters", "roast", "compliment", "kill", "kiss"
        ])
    };
    const prefixAliases = {
        dnatest: "m!dnatest [@user]",
        gaytest: "m!gaytest [@user]",
        iqtest: "m!iqtest [@user]",
        lovetest: "m!lovetest @user1 @user2",
        rizztest: "m!rizztest [@user]",
        lucktest: "m!lucktest [@user]",
        chatest: "m!chatest [@user]",
        charoll: "m!charoll [@user]",
        roast: "m!roast @user",
        compliment: "m!compliment @user",
        kill: "m!kill @user",
        kiss: "m!kiss @user"
    };
    const commandSyntax = command => {
        const data = command.data.toJSON();
        const options = data.options || [];
        const syntaxFor = (name, optionsList) => {
            const args = optionsList
                .filter(option => option.type !== 1 && option.type !== 2)
                .map(option => ` ${option.required ? "<" : "["}${option.name}${option.required ? ">" : "]"}`)
                .join("");
            return `${name}${args}`;
        };
        const expand = (name, optionsList) => {
            const subcommands = optionsList.filter(option => option.type === 1 || option.type === 2);
            if (!subcommands.length) return [syntaxFor(name, optionsList)];
            return subcommands.flatMap(option => expand(`${name} ${option.name}`, option.options || []));
        };
        return expand(`/${data.name}`, options).join(" · ");
    };

    for (const file of files) {
        const command = require(path.join(commandDir, file));
        const data = command.data?.toJSON?.();
        const name = data?.name || "";
        if (!name || command.adminOnly || data.default_member_permissions) continue;
        const alias = prefixAliases[name];
        const entry = {
            syntax: `${commandSyntax(command)}${alias ? ` · \`${alias}\`` : ""}`,
            description: data.description || "No description provided."
        };
        const category = categories.fun.has(name) ? "FUN & SOCIAL"
            : categories.utility.has(name) ? "UTILITY"
            : categories.economy.has(name) ? "ECONOMY"
                : categories.gambling.has(name) ? "GAMBLING"
                    : categories.collection.has(name) ? "SHOP & COLLECTION"
                        : categories.banking.has(name) ? "BANKING"
                            : categories.achievements.has(name) ? "ACHIEVEMENTS"
                                : "OTHER";
        groups[category].push(entry);
    }
    const categoryOrder = ["UTILITY", "FUN & SOCIAL", "ECONOMY", "GAMBLING", "SHOP & COLLECTION", "BANKING", "ACHIEVEMENTS", "OTHER"];
    const fields = [];
    for (const category of categoryOrder) {
        const lines = groups[category].map(entry => `\`${entry.syntax}\` — ${entry.description}`);
        let chunk = "";
        let index = 1;
        for (const line of lines) {
            if (chunk && `${chunk}\n${line}`.length > 950) {
                fields.push({ name: index === 1 ? category : `${category} (${index})`, value: chunk });
                chunk = "";
                index++;
            }
            chunk = chunk ? `${chunk}\n${line}` : line;
        }
        if (chunk) fields.push({ name: index === 1 ? category : `${category} (${index})`, value: chunk });
    }
    const page = interaction.options.getInteger?.("page") || 1;
    const pageSize = 5;
    const pageCount = Math.max(1, Math.ceil(fields.length / pageSize));
    if (page > pageCount) throw new UserFacingError(`Help has ${pageCount} page(s).`);
    await sendReply(interaction, economyReply(
        `MARK Help · page ${page}/${pageCount}`,
        `Public commands · use \`/help page:${Math.min(page + 1, pageCount)}\` for the next page.`,
        { fields: fields.slice((page - 1) * pageSize, page * pageSize) }
    ));
}

function readCurrencyAmount(interaction, label, allowZero = false) {
    const text = interaction.options.getString?.("amount");
    if (text !== null && text !== undefined) return parseCompactCurrencyInput(text, { label, allowZero });
    const integer = interaction.options.getInteger?.("amount");
    return parseCompactCurrencyInput(integer, { label, allowZero });
}

async function executeAdminWalletChange(interaction, action) {
    assertGuildInteraction(interaction);
    if (interaction.user.id !== ECONOMY_ADMIN_ID) {
        throw new UserFacingError("You are not authorized to administer the global economy.");
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("user");
    if (!target || target.bot) throw new UserFacingError("Choose a valid non-bot target user.");
    const amount = readCurrencyAmount(
        interaction,
        action === "set" ? "Wallet amount" : `${action} amount`,
        action === "set"
    );
    const result = await economy.adminWalletChange({
        guildId: interaction.guildId,
        adminUserId: interaction.user.id,
        targetUserId: target.id,
        action,
        amount,
        operationId: interaction.id
    });
    await sendReply(interaction, privateReply(
        `Set **${target.username || target.id}**'s wallet from **${formatCoins(result.balanceBefore)}** to **${formatCoins(result.balanceAfter)}**.`,
    ));
}

async function executeReset(interaction) {
    assertGuildInteraction(interaction);
    if (interaction.user.id !== ECONOMY_ADMIN_ID) {
        throw new UserFacingError("You are not authorized to administer the global economy.");
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("user");
    if (!target || target.bot) throw new UserFacingError("Choose a valid non-bot target user.");
    const token = interaction.options.getString("confirm");
    if (token) {
        const result = await economy.confirmBalanceReset({
            guildId: interaction.guildId,
            adminUserId: interaction.user.id,
            token,
            scope: "user",
            operationId: interaction.id
        });
        await sendReply(interaction, privateReply(
            `Reset the global wallet for <@${target.id}> to **${formatCoins(result.resetTo)}**. Bank funds, inventory, titles, counting data, and transaction history were preserved.`
        ));
        return;
    }
    const preview = await economy.requestBalanceReset({
        guildId: interaction.guildId,
        adminUserId: interaction.user.id,
        targetUserId: target.id
    });
    const account = await economy.getAccount(interaction.guildId, target.id);
    await sendReply(interaction, privateReply(
        `**Confirmation required — one global account**\nTarget: <@${target.id}> · Current wallet: ${formatCoins(account.wallet)} · Affected accounts: **${preview.affectedAccountCount}** · New wallet: ${formatCoins(1000)}.\nThis changes the global wallet only and preserves bank funds, inventory, titles, counting data, and history. Confirm within five minutes with \`/reset user:<@${target.id}> confirm:${preview.token}\`.`
    ));
}

async function executeResetAll(interaction) {
    assertGuildInteraction(interaction);
    if (interaction.user.id !== ECONOMY_ADMIN_ID) {
        throw new UserFacingError("You are not authorized to administer the global economy.");
    }
    await interaction.deferReply({ ephemeral: true });
    const token = interaction.options.getString("confirm");
    if (token) {
        const result = await economy.confirmBalanceReset({
            guildId: interaction.guildId,
            adminUserId: interaction.user.id,
            token,
            scope: "global",
            operationId: interaction.id
        });
        await sendReply(interaction, privateReply(
            `Global reset complete: **${result.affectedAccountCount}** accounts now have **${formatCoins(result.resetTo)}** in their wallets. Bank funds, inventory, titles, counting data, and transaction history were preserved.`
        ));
        return;
    }
    const preview = await economy.requestBalanceReset({
        guildId: interaction.guildId,
        adminUserId: interaction.user.id
    });
    await sendReply(interaction, privateReply(
        `**GLOBAL reset confirmation required**\nScope: every global economy account across all servers · Estimated accounts: **${preview.affectedAccountCount}** · New wallet balance: ${formatCoins(1000)} each.\nThis is not limited to this server. Bank funds, inventory, titles, counting data, and transaction history will be preserved. Confirm within five minutes with \`/resetall confirm:${preview.token}\`.`
    ));
}

async function executeAvatarDisplayName(interaction, user, member) {
    return displayName(interaction.guildId, user, member);
}

module.exports = {
    executeBalance: defer(executeBalance, false),
    executeReward: (interaction, kind) => {
        const handler = async current => executeReward(current, kind);
        return defer(handler, false)(interaction);
    },
    executeGive: defer(executeGive, false),
    executeSteal: defer(executeSteal, false),
    executeCoinflip: defer(executeCoinflip, false),
    executeLottery: defer(executeLottery, false),
    executeRichest: defer(executeRichest, false),
    executeProfile: defer(executeProfile, false),
    executeEconomyStats: defer(executeEconomyStats, false),
    executeTransactions: defer(executeTransactions, true),
    executeCooldowns: defer(executeCooldowns, false),
    executeShop: defer(executeShop, false),
    executeItem: defer(executeItem, false),
    executeInventory: defer(executeInventory, false),
    executeUse: defer(executeUse, false),
    executeBoosts: defer(executeBoosts, false),
    executeTitles: defer(executeTitles, false),
    executeBank: defer(executeBank, false),
    executeDeposit: defer(executeDeposit, false),
    executeWithdraw: defer(executeWithdraw, false),
    executeBankFunds: defer(executeBankFunds, false),
    executeBankHistory: defer(executeBankHistory, true),
    executeAchievements: defer(executeAchievements, false),
    executeHelp: defer(executeHelp, false),
    executeAdminWalletChange,
    executeReset,
    executeResetAll,
    executeAvatarDisplayName
};
