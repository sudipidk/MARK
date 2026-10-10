const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
    if (db) return db;

    const uri = process.env.MONGODB_URI?.trim() || process.env.MONGO_URL?.trim();
    if (!uri) {
        throw new Error("MONGODB_URI is required to connect to MongoDB.");
    }

    const mongoClient = new MongoClient(uri, {
        connectTimeoutMS: 10_000,
        serverSelectionTimeoutMS: 15_000
    });
    try {
        await mongoClient.connect();
    } catch (error) {
        try {
            await mongoClient.close();
        } catch {
            // Preserve the original connection error for startup diagnostics.
        }
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

function getClient() {
    if (!client) {
        throw new Error("MongoDB is not connected. Call connectDB() first.");
    }
    return client;
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
    getClient,
    closeDB
};
