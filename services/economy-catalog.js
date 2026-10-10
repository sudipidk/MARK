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
    { id: "avenger", name: "Avenger", rarity: "Mythic", price: 25000000, resalePrice: 12500000 }
].map(item => Object.freeze({
    category: "title",
    description: `${item.rarity} title. Rarity is descriptive and provides no gameplay advantage.`,
    sellable: item.weeklyStock === undefined,
    ...item
}));

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
const catalogById = new Map(catalog.map(item => [item.id, item]));

function getCatalogItem(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return catalogById.get(normalized) ||
        catalog.find(item => item.name.toLowerCase() === normalized) ||
        null;
}

module.exports = { catalog, titles, consumables, getCatalogItem };
