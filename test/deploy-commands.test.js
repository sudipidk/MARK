const assert = require("node:assert/strict");
const test = require("node:test");
const { Routes } = require("discord.js");
const { deployCommands, loadCommands } = require("../deploy-commands");

test("deploys global commands and mirrors them to an optional test guild", async () => {
    const calls = [];
    const rest = {
        async put(route, options) {
            calls.push({ route, options });
        }
    };
    const commandData = [{ name: "ping" }];

    await deployCommands(rest, commandData, "application-id", "test-guild-id");

    assert.deepEqual(calls, [
        {
            route: Routes.applicationCommands("application-id"),
            options: { body: commandData }
        },
        {
            route: Routes.applicationGuildCommands("application-id", "test-guild-id"),
            options: { body: commandData }
        }
    ]);
});

test("deploys globally when no test guild is configured", async () => {
    const calls = [];
    await deployCommands({
        async put(route, options) {
            calls.push({ route, options });
        }
    }, [], "application-id");

    assert.deepEqual(calls, [{
        route: Routes.applicationCommands("application-id"),
        options: { body: [] }
    }]);
});

test("all project slash commands are available in the deployment payload", () => {
    const commands = loadCommands();
    const names = new Set(commands.map(command => command.name));
    assert(names.has("afk"));
    assert(names.has("remind"));
    assert(names.has("reminders"));
    assert(names.has("reminder"));
    assert(names.has("counting-channel"));
    assert(names.has("suggestion"));
    assert(names.has("bank"));
    assert(names.has("bankfunds"));
    assert(names.has("deposit"));
    assert(names.has("withdraw"));
    assert(names.has("achievements"));
    assert(names.has("help"));
    assert(names.has("addmoney"));
    assert(names.has("removemoney"));
    assert(names.has("setmoney"));
    assert(names.has("reset"));
    assert(names.has("resetall"));
    assert(names.has("wordle"));
    for (const name of [
        "dnatest", "gaytest", "iqtest", "lovetest", "rizztest", "lucktest",
        "chatest", "charoll", "characters", "roast", "compliment", "kill", "kiss"
    ]) {
        assert(names.has(name));
    }
});
