// Tests for bilingual-toggle.js against a copy of the game's LangLabel code.
// Run: node tests/toggle.test.js <generated-script>
"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync(process.argv[2], "utf8");

function makeGame() {
  // Port of ig.Lang's note stripping and ig.LangLabel from game.compiled.js.
  function cut(b) {
    if (!b || typeof b !== "string") return b;
    let c = b.indexOf("<<C<<");
    if (c !== -1) return b.substr(0, c);
    c = b.indexOf("<<A<<");
    return c !== -1 ? b.substr(0, c) : b;
  }
  const ig = { currentLang: "de_DE" };
  function LangLabel(data) { this.data = data; this.langUid = data.langUid || 1; this.value = LangLabel.getText(this.data); }
  LangLabel.prototype = { value: null, data: null, toString() { return this.value; } };
  LangLabel.getText = function (b, c) {
    if (b && typeof b === "object") {
      let d = cut(b[ig.currentLang]);
      if ((c ? d !== undefined : d) && d !== ig.currentLang) return d;
      d = cut(b.en_US);
      return (c ? d !== undefined : d) && d !== "en_US" ? d : "MISSING LABEL";
    }
    return cut(b) || "MISSING LABEL";
  };
  ig.LangLabel = LangLabel;
  return ig;
}

// Minimal stand-ins for the game's dialogue box classes (sc.MsgBoxGui and parts).
const area = { messages: [] };
function makeDialogue() {
  function TextBlock() { this.text = ""; this.done = false; this.onFinish = null; }
  TextBlock.prototype = {
    setText(t) { this.text = String(t); this.done = false; },
    isFinished() { return this.done; },
    finish() { this.done = true; if (this.onFinish) this.onFinish(); },
  };
  function TextGui(t) { this.textBlock = new TextBlock(); this.hook = { size: {} }; this.setText(t); }
  TextGui.prototype.setText = function (t) {
    this.textBlock.setText(t);
    this.hook.size = { x: 100, y: this.textBlock.text.split("\n").length * 10 };
  };
  function MsgBoxGui(width, pointer, text) { this.init(width, pointer, text); }
  MsgBoxGui.prototype = {
    init(width, pointer, text) {
      this.personEntry = { area };
      this.text = new TextGui(text);
      this.box = {
        pointerType: pointer, hook: { size: {}, pivot: {} },
        resize(w, h) { this.hook.size = { x: w + 17, y: h + 8 }; },
      };
      this.box.resize(this.text.hook.size.x, this.text.hook.size.y);
      this.hook = { pos: { x: 112, y: 13 }, size: { ...this.box.hook.size }, pivot: {} };
    },
    doPosTranstition(x, y) { this.hook.pos = { x, y }; },
  };
  MsgBoxGui.inject = function (props) { // like ig.Class.inject: this.parent is the old method
    for (const key of Object.keys(props)) {
      const parent = this.prototype[key];
      this.prototype[key] = function () {
        const saved = this.parent; this.parent = parent;
        try { return props[key].apply(this, arguments); } finally { this.parent = saved; }
      };
    }
  };
  return { MsgBoxGui };
}

const listeners = [];
const storage = {};
const elements = [];
const window = {
  ig: makeGame(),
  sc: makeDialogue(),
  setTimeout: (fn) => fn(),
  clearTimeout() {},
  addEventListener: (type, fn) => listeners.push(fn),
  localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
};
const document = {
  createElement() { const el = { style: {}, textContent: "" }; elements.push(el); return el; },
  body: { appendChild() {} },
};
vm.runInNewContext(script, { window, document });

const ig = window.ig;
const press = (keyCode) => listeners.forEach((fn) => fn({ keyCode, repeat: false, preventDefault() {} }));
const label = {
  en_US: "Hello.",
  de_DE: "Hallo.\\c[4]\nHello.\\c[0]",
  bilingualOriginal: "Hallo.<<C<<Geprüft: X",
  langUid: 1,
};
const plain = { en_US: "Same", de_DE: "Gleich" }; // not merged: always the game's normal text
const early = new ig.LangLabel(label); // created before any switch

assert.strictEqual(ig.LangLabel.getText(label), "Hallo.\\c[4]\nHello.\\c[0]");
press(120); // F9: primary only
assert.strictEqual(ig.LangLabel.getText(label), "Hallo.");
assert.strictEqual(String(early), "Hallo.", "existing labels follow the switch");
assert.strictEqual(early.value, "Hallo.");
assert.strictEqual(ig.LangLabel.getText(plain), "Gleich");
assert.strictEqual(storage.crossCulturalMode, "1");
assert.match(elements[0].textContent, /Deutsch/);
press(120); // secondary only
assert.strictEqual(ig.LangLabel.getText(label), "Hello.");
assert.strictEqual(new ig.LangLabel(label).toString(), "Hello.");
press(121); // other keys do nothing
assert.strictEqual(ig.LangLabel.getText(label), "Hello.");
press(120); // back to both
assert.strictEqual(ig.LangLabel.getText(label), "Hallo.\\c[4]\nHello.\\c[0]");
assert.match(elements[0].textContent, /Deutsch \+ English/);

// Dialogue already on screen is redrawn in place.
const sc = window.sc;
const older = new sc.MsgBoxGui(200, 1, new ig.LangLabel(label));
older.text.textBlock.finish();
let finishedAgain = 0;
older.text.textBlock.onFinish = () => finishedAgain++;
const typing = new sc.MsgBoxGui(200, 1, new ig.LangLabel(label));
const fixed = new sc.MsgBoxGui(200, 1, "Plain string");
area.messages.push(older, fixed, typing);
assert.strictEqual(older.text.textBlock.text, "Hallo.\\c[4]\nHello.\\c[0]");
assert.strictEqual(older.hook.size.y, 28);
press(120); // primary only
assert.strictEqual(older.text.textBlock.text, "Hallo.");
assert.strictEqual(typing.text.textBlock.text, "Hallo.");
assert.strictEqual(fixed.text.textBlock.text, "Plain string");
assert.ok(older.text.textBlock.isFinished(), "a finished line stays finished");
assert.strictEqual(finishedAgain, 0, "a finished line does not report finishing again");
assert.ok(!typing.text.textBlock.isFinished(), "a line being typed types again");
assert.strictEqual(older.hook.size.x, 118, "bubble width is even");
assert.strictEqual(older.hook.size.y, 18, "bubble fits the new text");
assert.strictEqual(fixed.hook.pos.y, typing.hook.size.y + 15, "older lines restack above the newest");
assert.strictEqual(older.hook.pos.y, typing.hook.size.y + 15 + fixed.hook.size.y + 2);
press(120); press(120); // back to both
assert.strictEqual(older.text.textBlock.text, "Hallo.\\c[4]\nHello.\\c[0]");
assert.strictEqual(older.hook.size.y, 28);

// Another language selected in the options: the switch stays off.
press(120);
ig.currentLang = "ja_JP";
press(120);
assert.strictEqual(storage.crossCulturalMode, "1");
assert.match(elements[0].textContent, /Select Deutsch/);
assert.strictEqual(ig.LangLabel.getText({ ...label, ja_JP: "こんにちは" }), "こんにちは");

console.log("toggle tests passed");
