const ACHIEVEMENTS = [
    {
        id: "first-fortune",
        name: "First Fortune",
        description: "Reach a wallet balance of at least 10,000 coins.",
        rarity: "Rare",
        difficulty: 1,
        rewardCoins: 5000,
        rewardTags: ["Poor Boi"]
    },
    {
        id: "coin-flip-winner",
        name: "Coin Flip Winner",
        description: "Win 10 valid /cf bets.",
        rarity: "Rare",
        difficulty: 2,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "unlucky-flipper",
        name: "Unlucky Flipper",
        description: "Lose 5 valid /cf bets.",
        rarity: "Rare",
        difficulty: 2,
        rewardCoins: 5000,
        rewardTags: ["Unlucky"]
    },
    {
        id: "robbery-victim",
        name: "Robbery Victim",
        description: "Be successfully robbed five times.",
        rarity: "Rare",
        difficulty: 3,
        rewardCoins: 10000,
        rewardTags: ["Unlucky"]
    },
    {
        id: "pocket-change",
        name: "Pocket Change",
        description: "Earn 10,000 coins cumulatively through legitimate earnings.",
        rarity: "Uncommon",
        difficulty: 4,
        rewardCoins: 1000,
        rewardTags: []
    },
    {
        id: "making-progress",
        name: "Making Progress",
        description: "Earn 100,000 coins cumulatively.",
        rarity: "Rare",
        difficulty: 4,
        rewardCoins: 5000,
        rewardTags: []
    },
    {
        id: "self-made",
        name: "Self-Made",
        description: "Earn 1,000,000 coins cumulatively.",
        rarity: "Epic",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "millionaire",
        name: "Millionaire",
        description: "Reach a wallet balance of 1,000,000 coins.",
        rarity: "Epic",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "billionaire",
        name: "Billionaire",
        description: "Reach a wallet balance of 1,000,000,000 coins.",
        rarity: "Legendary",
        difficulty: 8,
        rewardCoins: 50000,
        rewardTags: ["Billionaire"]
    },
    {
        id: "workaholic",
        name: "Workaholic",
        description: "Complete 100 successful work actions.",
        rarity: "Uncommon",
        difficulty: 6,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "dedicated-worker",
        name: "Dedicated Worker",
        description: "Complete 500 successful work actions.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 50000,
        rewardTags: []
    },
    {
        id: "daily-discipline",
        name: "Daily Discipline",
        description: "Claim 30 daily rewards.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 15000,
        rewardTags: []
    },
    {
        id: "weekly-regular",
        name: "Weekly Regular",
        description: "Claim 12 weekly rewards.",
        rarity: "Epic",
        difficulty: 6,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "generous-soul",
        name: "Generous Soul",
        description: "Give other players a cumulative 50,000 coins through legitimate transfers.",
        rarity: "Uncommon",
        difficulty: 4,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "benefactor",
        name: "Benefactor",
        description: "Give other players a cumulative 500,000 coins.",
        rarity: "Epic",
        difficulty: 6,
        rewardCoins: 50000,
        rewardTags: []
    },
    {
        id: "community-supporter",
        name: "Community Supporter",
        description: "Complete 100 valid transfers to other players.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "risk-taker",
        name: "Risk Taker",
        description: "Place 50 valid /cf wagers.",
        rarity: "Uncommon",
        difficulty: 4,
        rewardCoins: 5000,
        rewardTags: []
    },
    {
        id: "high-roller",
        name: "High Roller",
        description: "Win a valid /cf wager of at least 100,000 coins.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "double-down",
        name: "Double Down",
        description: "Win 25 /cf bets.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "house-favourite",
        name: "House Favourite",
        description: "Win 100 /cf bets.",
        rarity: "Legendary",
        difficulty: 8,
        rewardCoins: 100000,
        rewardTags: []
    },
    {
        id: "lucky-seven",
        name: "Lucky Seven",
        description: "Win seven number-lottery bets.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 15000,
        rewardTags: []
    },
    {
        id: "lottery-legend",
        name: "Lottery Legend",
        description: "Win 50 number-lottery bets.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 75000,
        rewardTags: []
    },
    {
        id: "big-jackpot",
        name: "Big Jackpot",
        description: "Win a lottery payout of at least 100,000 coins.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "comeback",
        name: "Comeback",
        description: "Win a valid gamble after recording at least five consecutive gambling losses.",
        rarity: "Rare",
        difficulty: 6,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "career-criminal",
        name: "Career Criminal",
        description: "Successfully rob other players 10 times.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 15000,
        rewardTags: []
    },
    {
        id: "master-thief",
        name: "Master Thief",
        description: "Successfully rob other players 50 times.",
        rarity: "Legendary",
        difficulty: 8,
        rewardCoins: 75000,
        rewardTags: []
    },
    {
        id: "untouchable",
        name: "Untouchable",
        description: "Successfully avoid being robbed 10 times.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 20000,
        rewardTags: []
    },
    {
        id: "collector",
        name: "Collector",
        description: "Own five distinct eligible cosmetic tags.",
        rarity: "Rare",
        difficulty: 4,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "elite-collector",
        name: "Elite Collector",
        description: "Own ten distinct eligible cosmetic tags.",
        rarity: "Epic",
        difficulty: 6,
        rewardCoins: 50000,
        rewardTags: []
    },
    {
        id: "rare-find",
        name: "Rare Find",
        description: "Own three distinct tags with Rare or higher rarity.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "ultimate-collector",
        name: "Ultimate Collector",
        description: "Own 20 distinct eligible cosmetic tags.",
        rarity: "Mythic",
        difficulty: 9,
        rewardCoins: 0,
        rewardTags: ["Ultimate Collector"]
    },
    {
        id: "banker",
        name: "Banker",
        description: "Have at least 100,000 coins in the bank.",
        rarity: "Rare",
        difficulty: 4,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "financially-secure",
        name: "Financially Secure",
        description: "Have at least 1,000,000 combined wallet and bank coins.",
        rarity: "Epic",
        difficulty: 6,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "long-term-saver",
        name: "Long-Term Saver",
        description: "Keep a deposit locked for its full 12-hour period and then withdraw it.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "fee-free-threshold",
        name: "Fee-Free Threshold",
        description: "Withdraw exactly 10,000 coins without a withdrawal fee.",
        rarity: "Uncommon",
        difficulty: 4,
        rewardCoins: 5000,
        rewardTags: []
    },
    {
        id: "consistent-saver",
        name: "Consistent Saver",
        description: "Complete 25 valid deposits.",
        rarity: "Rare",
        difficulty: 5,
        rewardCoins: 25000,
        rewardTags: []
    },
    {
        id: "veteran",
        name: "Veteran",
        description: "Have a global economy account at least 30 days old.",
        rarity: "Uncommon",
        difficulty: 4,
        rewardCoins: 10000,
        rewardTags: []
    },
    {
        id: "seasoned-veteran",
        name: "Seasoned Veteran",
        description: "Have a global economy account at least 90 days old.",
        rarity: "Epic",
        difficulty: 6,
        rewardCoins: 30000,
        rewardTags: []
    },
    {
        id: "legendary-veteran",
        name: "Legendary Veteran",
        description: "Have a global economy account at least 365 days old.",
        rarity: "Mythic",
        difficulty: 9,
        rewardCoins: 0,
        rewardTags: ["Legendary Veteran"]
    },
    {
        id: "prize-winner",
        name: "Prize Winner",
        description: "Win a single prize pool payout of at least 5,000 coins.",
        rarity: "Uncommon",
        difficulty: 3,
        rewardCoins: 2500,
        rewardTags: []
    },
    {
        id: "global-collector",
        name: "Global Collector",
        description: "Own 15 distinct cosmetic titles across all global servers.",
        rarity: "Epic",
        difficulty: 7,
        rewardCoins: 35000,
        rewardTags: []
    }
];

function getAchievementCatalog() {
    return ACHIEVEMENTS.map(achievement => ({
        ...achievement,
        rewardTags: [...(achievement.rewardTags || [])]
    }));
}

function getAchievementById(id) {
    return ACHIEVEMENTS.find(achievement => achievement.id === id) || null;
}

module.exports = {
    ACHIEVEMENTS,
    getAchievementCatalog,
    getAchievementById
};
