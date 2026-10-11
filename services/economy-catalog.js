const titles = [
    { id: "phantom", name: "Phantom", rarity: "Common", price: 5000, resalePrice: 2500 },
    { id: "falcon", name: "Falcon", rarity: "Uncommon", price: 25000, resalePrice: 12500 },
    { id: "agent", name: "Agent", rarity: "Limited", price: 50000, weeklyStock: 2 },
    { id: "overlord", name: "Overlord", rarity: "Rare", price: 100000, resalePrice: 50000 },
    { id: "warlord", name: "Warlord", rarity: "Epic", price: 250000, resalePrice: 125000 },
    { id: "variant", name: "Variant", rarity: "Limited", price: 750000, weeklyStock: 2, permitsDuplicates: true },
    { id: "guardian", name: "Guardian", rarity: "Epic", price: 1000000, resalePrice: 500000 },
    { id: "sorcerer", name: "Sorcerer", rarity: "Legendary", price: 5000000, resalePrice: 2500000 },
    { id: "sorcerer-supreme", name: "Sorcerer Supreme", rarity: "Mythic", price: 15000000, weeklyStock: 1 },
    { id: "ones-above-all", name: "Ones Above All", rarity: "Mythic", price: 25000000, resalePrice: 12500000 },
    { id: "gooner", name: "Gooner", rarity: "Rare", price: 50000, resalePrice: 25000, stock: Infinity },
    { id: "pathfinder", name: "Pathfinder", rarity: "Uncommon", price: 75000, resalePrice: 37500 },
    { id: "nightwatch", name: "Nightwatch", rarity: "Rare", price: 150000, resalePrice: 75000 },
    { id: "celestial", name: "Celestial", rarity: "Epic", price: 400000, resalePrice: 200000 },
    { id: "ember", name: "Ember", rarity: "Uncommon", price: 60000, resalePrice: 30000 },
    { id: "frostborn", name: "Frostborn", rarity: "Rare", price: 200000, resalePrice: 100000 },
    { id: "trailblazer", name: "Trailblazer", rarity: "Epic", price: 600000, resalePrice: 300000 },
    { id: "sovereign", name: "Sovereign", rarity: "Legendary", price: 3000000, resalePrice: 1500000 },
    { id: "eclipse", name: "Eclipse", rarity: "Mythic", price: 12000000, resalePrice: 6000000 },
    { id: "astral", name: "Astral", rarity: "Legendary", price: 7500000, resalePrice: 3750000 }
].map(item => Object.freeze({
    category: "title",
    description: `${item.rarity} title. Rarity is descriptive and provides no gameplay advantage.`,
    sellable: item.weeklyStock === undefined && item.id !== "gooner" ? true : item.id === "gooner",
    ...item
}));

const exclusiveTags = [
    { id: "poor-boi", name: "Poor Boi", rarity: "Rare", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Achievement reward for First Fortune." },
    { id: "unlucky", name: "Unlucky", rarity: "Rare", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Achievement reward tied to unlucky and robbery milestones." },
    { id: "the-dark-knight", name: "The Dark Knight", rarity: "Mythic", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Exclusive reward for earning every active achievement." },
    { id: "billionaire", name: "Billionaire", rarity: "Legendary", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Achievement reward for reaching a billion wallet coins." },
    { id: "ultimate-collector", name: "Ultimate Collector", rarity: "Mythic", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Achievement reward for completing the cosmetic collection." },
    { id: "legendary-veteran", name: "Legendary Veteran", rarity: "Mythic", category: "title", sellable: false, purchaseable: false, exclusive: true, description: "Achievement reward for a year of global economy history." }
];

const consumables = [
    {
        id: "coinflip-luck-i",
        name: "Coinflip Luck I",
        description: "Raises coinflip win chance to 56% for five minutes per use.",
        rarity: "Uncommon",
        price: 5000,
        resalePrice: 2500,
        durationMs: 5 * 60 * 1000,
        effect: "56% coinflip win chance; duration stacks by use."
    },
    {
        id: "coinflip-luck-ii",
        name: "Coinflip Luck II",
        description: "Raises coinflip win chance to 63% for five minutes per use.",
        rarity: "Rare",
        price: 25000,
        resalePrice: 12500,
        durationMs: 5 * 60 * 1000,
        effect: "63% coinflip win chance; takes priority over Luck I."
    },
    {
        id: "bodyguard",
        name: "Bodyguard",
        description: "Protects you from stealing attempts for 24 hours.",
        rarity: "Uncommon",
        price: 10000,
        resalePrice: 5000,
        durationMs: 24 * 60 * 60 * 1000,
        effect: "Reduces the success chance of steals targeting you."
    }
].map(item => Object.freeze({
    category: "consumable",
    sellable: true,
    stackable: true,
    ...item
}));

const catalog = [...titles, ...consumables];
const allCatalog = [...catalog, ...exclusiveTags];
const catalogById = new Map(allCatalog.map(item => [item.id, item]));
if (catalogById.has("ones-above-all")) {
    catalogById.set("avenger", catalogById.get("ones-above-all"));
}

function getCatalogItem(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
    return catalogById.get(normalized) ||
        allCatalog.find(item => item.name.toLowerCase().replace(/\s+/g, "-") === normalized) ||
        null;
}

module.exports = { catalog, allCatalog, titles, consumables, exclusiveTags, getCatalogItem };
