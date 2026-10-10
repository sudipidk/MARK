module.exports = Object.freeze({
    startingBalance: 1000,
    daily: { cooldownMs: 24 * 60 * 60 * 1000, minimum: 500, maximum: 1000 },
    weekly: { cooldownMs: 7 * 24 * 60 * 60 * 1000, minimum: 5000, maximum: 10000 },
    work: {
        cooldownMs: 60 * 60 * 1000,
        minimum: 300,
        maximum: 1200,
        jobs: ["delivered packages", "fixed a neighbor's computer", "walked some dogs", "helped at the market"]
    },
    beg: { cooldownMs: 30 * 60 * 1000, successPercent: 60, minimum: 50, maximum: 300 },
    steal: {
        cooldownMs: 60 * 60 * 1000,
        minimumWallet: 500,
        minimumTargetWallet: 20,
        minimumPercent: 5,
        maximumPercent: 15,
        maximumAmount: 10000,
        finePercent: 25,
        successPercentByGuards: [30, 25, 10, 5]
    },
    coinflip: { minimumStake: 100, maximumStake: 100000, baseWinPercent: 50, totalWinMultiplier: 2 },
    lottery: {
        ticketPrice: 1000,
        scheduleTimeZone: "Asia/Kathmandu",
        scheduleBoundary: "00:00"
    },
    shop: {
        bodyguardDurationMs: 24 * 60 * 60 * 1000,
        maximumActiveBodyguards: 3,
        luckDurationMs: 5 * 60 * 1000,
        weeklyRestockTimeZone: "Asia/Kathmandu",
        weeklyRestockBoundary: "Monday 00:00"
    }
});
