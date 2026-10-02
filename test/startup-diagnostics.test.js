const assert = require("node:assert/strict");
const test = require("node:test");
const {
    getStartupConfig,
    formatStartupError
} = require("../services/startup-diagnostics");

test("startup configuration accepts explicit MongoDB variables without exposing values", () => {
    assert.deepEqual(getStartupConfig({
        TOKEN: " discord-token ",
        MONGODB_URI: " mongodb+srv://user:password@example.mongodb.net/MARK "
    }), {
        token: "discord-token",
        mongoUri: "mongodb+srv://user:password@example.mongodb.net/MARK"
    });

    assert.deepEqual(getStartupConfig({
        TOKEN: "discord-token",
        MONGODB_URI: " ",
        MONGO_URL: "mongodb://user:password@mongo:27017/MARK"
    }), {
        token: "discord-token",
        mongoUri: "mongodb://user:password@mongo:27017/MARK"
    });
});

test("startup configuration reports missing and malformed variables clearly", () => {
    assert.throws(
        () => getStartupConfig({ TOKEN: "", MONGODB_URI: "mongodb://mongo/MARK" }),
        /TOKEN is missing or empty/
    );
    assert.throws(
        () => getStartupConfig({ TOKEN: "token", MONGODB_URI: "" }),
        /MONGODB_URI is missing or empty/
    );
    assert.throws(
        () => getStartupConfig({ TOKEN: "token", MONGODB_URI: "not-a-uri" }),
        /must begin with mongodb:\/\//
    );
});

test("startup error diagnostics include useful messages while redacting secrets", () => {
    const token = "discord-secret-token";
    const uri = "mongodb+srv://db-user:db-password@example.mongodb.net/MARK";
    const diagnostics = formatStartupError(
        Object.assign(new Error(`Login failed for ${token} at ${uri}`), { code: "EAUTH" }),
        [token, uri]
    );

    assert.equal(diagnostics.name, "Error");
    assert.equal(diagnostics.code, "EAUTH");
    assert.match(diagnostics.message, /Login failed/);
    assert.doesNotMatch(diagnostics.message, /discord-secret-token|db-password|db-user/);

    const embeddedCredentials = formatStartupError(
        new Error("Failed connecting to mongodb://user:password@host.example/db")
    );
    assert.doesNotMatch(embeddedCredentials.message, /user:password/);
});
