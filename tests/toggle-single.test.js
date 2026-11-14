// Tests for bilingual-toggle.js installed with --no-double: only one language at a time.
// Run: node tests/toggle-single.test.js <generated-script>
"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync(process.argv[2], "utf8");

function run(stored) {
  const listeners = [];
  const storage = stored === undefined ? {} : { crossCulturalMode: stored };
  const ig = { currentLang: "de_DE" };
  function LangLabel(data) { this.data = data; this.value = LangLabel.getText(data); }
  LangLabel.prototype = { toString() { return this.value; } };
  LangLabel.getText = (b) => (b && typeof b === "object" ? b[ig.currentLang] || b.en_US : b);
  ig.LangLabel = LangLabel;
  const window = {
    ig,
    setTimeout() { return 0; }, // nothing waits: the game is already loaded
    clearTimeout() {},
    addEventListener: (type, fn) => listeners.push(fn),
    localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
  };
  const elements = [];
  const document = {
    createElement() { const el = { style: {}, textContent: "" }; elements.push(el); return el; },
    body: { appendChild() {} },
  };
  vm.runInNewContext(script, { window, document });
  const press = () => listeners.forEach((fn) => fn({ keyCode: 120, repeat: false, preventDefault() {} }));
  return { ig, press, storage, elements };
}

const label = { en_US: "Hello.", de_DE: "Hallo.\\c[4]\nHello.\\c[0]", bilingualOriginal: "Hallo." };

// A fresh install starts with the primary language alone.
let game = run();
assert.strictEqual(game.ig.LangLabel.getText(label), "Hallo.");
game.press();
assert.strictEqual(game.ig.LangLabel.getText(label), "Hello.");
assert.strictEqual(game.elements[0].textContent, "Text: English  (F9)");
game.press(); // never both: straight back to the primary language
assert.strictEqual(game.ig.LangLabel.getText(label), "Hallo.");
assert.strictEqual(game.storage.crossCulturalMode, "1");
game.press();
assert.strictEqual(game.storage.crossCulturalMode, "2");

// "Both" remembered from an install with the double display is not used.
game = run("0");
assert.strictEqual(game.ig.LangLabel.getText(label), "Hallo.");
game = run("2");
assert.strictEqual(game.ig.LangLabel.getText(label), "Hello.");

console.log("single-language toggle tests passed");
