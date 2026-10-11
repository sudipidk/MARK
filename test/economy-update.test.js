const assert = require("node:assert/strict");
const test = require("node:test");
const { loadCommands } = require("../deploy-commands");
const { formatCoins, parseCompactCurrencyInput } = require("../services/economy-format");

test("compact currency parser accepts exact amounts and supported suffixes", () => {
    for (const [input, expected] of [
        ["1000", 1000],
        ["1k", 1000],
        ["1K", 1000],
        ["1.5k", 1500],
        ["2m", 2_000_000],
        ["2.5b", 2_500_000_000],
        ["1t", 1_000_000_000_000]
    ]) {
        assert.equal(parseCompactCurrencyInput(input), expected, input);
    }
    assert.equal(formatCoins(1500), "1,500 coins (1.5k)");
});

test("compact currency parser rejects malformed and fractional coin values", () => {
    for (const input of ["", "-1", "1.5", "1.0001k", "1e3", "NaN", "Infinity", "1.5q"]) {
        assert.throws(() => parseCompactCurrencyInput(input), undefined, input);
    }
    assert.throws(() => parseCompactCurrencyInput("9008t"));
});

test("banking, achievements, and help are real deployable slash command modules", () => {
    const commands = loadCommands();
    const byName = new Map(commands.map(command => [command.name, command]));
    for (const name of ["bank", "bankfunds", "deposit", "withdraw", "achievements", "help"]) {
        assert(byName.has(name), `/${name} is missing from deployment payload`);
    }
    assert.equal(byName.get("bank").options[0].name, "summary");
    assert.equal(byName.get("bank").options[1].name, "history");
    assert.equal(byName.get("deposit").options[0].type, 3);
    assert.equal(byName.get("withdraw").options[0].type, 3);
    assert.equal(byName.get("lottery").options[0].name, "number");
    assert.equal(byName.get("lottery").options[0].min_value, 1);
    assert.equal(byName.get("lottery").options[0].max_value, 10);
    assert.equal(byName.get("lottery").options[1].type, 3);
});
