const assert = require("node:assert/strict");
const test = require("node:test");
const {
    AUTOMATIC_REWARDS,
    generateAutomaticAnswer,
    evaluateGuess,
    validateAutomaticRewards,
    isValidDictionaryWord,
    validateWordLists
} = require("../services/wordle-engine");
const wordleCommand = require("../commands/wordle");

test("curated automatic dictionary contains 100 words of each supported length", () => {
    assert.doesNotThrow(validateWordLists);
    for (const [length, expectedReward] of [[5, 5000], [6, 7500], [7, 10000]]) {
        const values = [length === 5 ? 0 : length === 6 ? 75 : 95, 0];
        const generated = generateAutomaticAnswer({
            random: () => values.shift(),
            rewards: AUTOMATIC_REWARDS
        });
        assert.equal(generated.length, length);
        assert.equal(generated.word.length, length);
        assert.equal(generated.reward, expectedReward);
        assert.ok(isValidDictionaryWord(generated.word));
    }
});

test("automatic rewards reject any value below the guaranteed minimum", () => {
    assert.throws(
        () => validateAutomaticRewards({ 5: 4999, 6: 7500, 7: 10000 }),
        /at least 5000/
    );
    assert.deepEqual(validateAutomaticRewards(AUTOMATIC_REWARDS), AUTOMATIC_REWARDS);
});

test("weighted word lengths honor configured percentages", () => {
    const makeRandom = selection => maximum => maximum === 100 ? selection : 0;
    assert.equal(generateAutomaticAnswer({ random: makeRandom(69) }).length, 5);
    assert.equal(generateAutomaticAnswer({ random: makeRandom(70) }).length, 6);
    assert.equal(generateAutomaticAnswer({ random: makeRandom(90) }).length, 7);
    assert.throws(() => generateAutomaticAnswer({
        distribution: { 5: 70, 6: 20, 7: 9 }
    }), /totaling 100/);
});

test("guess evaluation handles exact, misplaced, gray, and repeated letters", () => {
    assert.deepEqual(
        evaluateGuess("ALLEY", "APPLE"),
        ["green", "yellow", "gray", "yellow", "gray"]
    );
    assert.deepEqual(
        evaluateGuess("EERIE", "LEVEL"),
        ["yellow", "green", "gray", "gray", "gray"]
    );
    assert.throws(() => evaluateGuess("CAT", "WORD"), /same length/);
});

test("custom dictionary includes one-letter and extended answers", () => {
    assert.equal(isValidDictionaryWord("a"), true);
    assert.equal(isValidDictionaryWord("AVENGERS"), true);
    assert.equal(isValidDictionaryWord("PYTHON"), true);
    assert.equal(isValidDictionaryWord("responsibility"), true);
    assert.equal(isValidDictionaryWord("not-a-word"), false);
});

test("Wordle slash command exposes player, queue, and owner/admin controls", () => {
    const command = wordleCommand.data.toJSON();
    assert.equal(command.name, "wordle");
    const names = command.options.map(option => option.name);
    for (const name of [
        "create", "queue-add", "queue", "queue-remove", "queue-move", "queue-edit",
        "queue-clear", "active", "skip", "end", "reveal", "set-channel", "settings", "stats",
        "leaderboard", "history", "admin"
    ]) assert.ok(names.includes(name), `missing /wordle ${name}`);
    assert.deepEqual(command.options.find(option => option.name === "admin").options.map(option => option.name), [
        "user", "stats"
    ]);
});
