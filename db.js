const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
    if (db) return db;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is required to connect to MongoDB.");
    }

    const mongoClient = new MongoClient(uri);
    try {
        await mongoClient.connect();
    } catch (error) {
        await mongoClient.close();
        throw error;
    }

    client = mongoClient;
    db = client.db("MARK");
    console.log("✅ Connected to MongoDB");
    return db;
}

function getDB() {
    if (!db) {
        throw new Error("MongoDB is not connected. Call connectDB() first.");
    }

    return db;
}

async function closeDB() {
    if (!client) return;

    const mongoClient = client;
    client = undefined;
    db = undefined;
    await mongoClient.close();
}

module.exports = {
    connectDB,
    getDB,
    closeDB
};
