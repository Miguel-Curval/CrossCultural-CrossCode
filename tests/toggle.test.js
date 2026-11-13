// Tests for bilingual-toggle.js against stand-ins for the game's code.
// Run: node tests/toggle.test.js <generated-script>
"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync(process.argv[2], "utf8");

// ---- Port of ig.Lang's note stripping and ig.LangLabel from game.compiled.js ----

function makeGame() {
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
  ig.interact = {
    entries: [],
    addEntry(e) { this.entries.push(e); },
    removeEntry(e) { this.entries = this.entries.filter((x) => x !== e); },
  };
  return ig;
}

// ---- Minimal stand-ins for the game's GUI classes ----

function makeClass(Base, proto) {
  function Class(...args) { this.init(...args); }
  Class.prototype = Object.assign(Object.create(Base ? Base.prototype : Object.prototype), proto);
  Class.prototype.constructor = Class;
  Class.inject = function (props) { // like ig.Class.inject: this.parent is the old method
    for (const key of Object.keys(props)) {
      const parent = this.prototype[key];
      this.prototype[key] = function () {
        const saved = this.parent; this.parent = parent;
        try { return props[key].apply(this, arguments); } finally { this.parent = saved; }
      };
    }
  };
  return Class;
}

const Gui = makeClass(null, {
  init() {
    this.hook = { pos: { x: 0, y: 0 }, size: { x: 0, y: 0 }, pivot: { x: 0, y: 0 }, children: [],
      gui: this, parentHook: null, currentStateName: "DEFAULT" };
  },
  addChildGui(g) { g.hook.parentHook = this.hook; this.hook.children.push(g.hook); },
  removeChildGui(g) { this.hook.children = this.hook.children.filter((h) => h !== g.hook); g.hook.parentHook = null; },
  setSize(x, y) { this.hook.size = { x, y }; },
  setPos(x, y) { this.hook.pos = { x, y }; },
  doPosTranstition(x, y) { this.hook.pos = { x, y }; },
  doStateTransition(name) { this.hook.currentStateName = name; },
});

// A text widget; its size follows the text (5 px per character, 10 px per line).
const TextGui = makeClass(Gui, {
  init(text) {
    Gui.prototype.init.call(this);
    this.stopped = false;
    this.textBlock = {
      shown: "", done: false, onFinish: null,
      isFinished() { return this.done; },
      finish() { this.done = true; if (this.onFinish) this.onFinish(); },
    };
    this.setText(text);
  },
  setText(text) {
    this.text = text;
    const shown = String(text);
    this.textBlock.shown = shown;
    this.textBlock.done = false;
    const lines = shown.split("\n");
    this.setSize(Math.max(...lines.map((l) => l.length)) * 5, lines.length * 10);
    this.stopped = false;
  },
  stop() { this.stopped = true; },
});

function makeSc(ig) {
  const MsgBoxGui = makeClass(Gui, {
    init(width, pointer, text) {
      Gui.prototype.init.call(this);
      this.text = new TextGui(text);
      this.box = new Gui();
      this.box.pointerType = pointer;
      this.box.resize = function (w, h) { this.setSize(w + 16, h + 8); };
      this.box.resize(this.text.hook.size.x, this.text.hook.size.y);
      this.setSize(this.box.hook.size.x, this.box.hook.size.y);
      this.setPos(112, 13);
      this.addChildGui(this.box);
      this.addChildGui(this.text);
    },
  });
  const MsgBoardGui = makeClass(Gui, {
    init(text) {
      Gui.prototype.init.call(this);
      this.content = new Gui();
      this.content.text = new TextGui(text);
      this.content.addChildGui(this.content.text);
      this.addChildGui(this.content);
    },
  });
  const ChoiceBoxGui = makeClass(Gui, {
    init(options, x, y) {
      Gui.prototype.init.call(this);
      this.buttonInteract = { id: Math.random() };
      this.buttonGroup = { current: { x: 0, y: 0 }, setCurrentFocus(cx, cy) { this.current = { x: cx, y: cy }; } };
      this.delayTimer = 0.3;
      this.buttons = options.map((o) => new TextGui("\\c[0]" + o.label));
      this.buttons.forEach((b) => this.addChildGui(b));
      this.setSize(Math.max(...this.buttons.map((b) => b.hook.size.x)) + 6, options.length * 20);
      this.setPos(x, y);
      this.doStateTransition("HIDDEN", true);
    },
  });
  const SideMessageBoxGui = makeClass(Gui, {
    init(message) {
      Gui.prototype.init.call(this);
      this.text = new TextGui(message);
      this.face = { charExpression: "lea", height: 0, setFace(c, h) { this.charExpression = c; this.height = h; } };
      this.addChildGui(this.text);
      this.setSize(163, 42);
    },
  });
  const SideMessageHudGui = makeClass(Gui, {
    init() { Gui.prototype.init.call(this); this.visibleBoxes = []; this.pauseBoxes = []; this.skips = 0; },
    updateSkipGui() { this.skips++; },
  });
  return { MsgBoxGui, MsgBoardGui, ChoiceBoxGui, SideMessageBoxGui, SideMessageHudGui };
}

// ---- Run the script in a fake window ----

const listeners = [];
const storage = {};
const elements = [];
const ig = makeGame();
const window = {
  ig,
  setTimeout: (fn) => fn(),
  clearTimeout() {},
  addEventListener: (type, fn) => listeners.push(fn),
  localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
  KEY_SPLINES: { EASE_OUT: "ease-out" },
};
window.sc = makeSc(ig);
const document = {
  createElement() { const el = { style: {}, textContent: "" }; elements.push(el); return el; },
  body: { appendChild() {} },
};
vm.runInNewContext(script, { window, document });
const sc = window.sc;
const press = (keyCode) => listeners.forEach((fn) => fn({ keyCode, repeat: false, preventDefault() {} }));
const F9 = 120;

// ---- Text lookup ----

const label = {
  en_US: "Hello.",
  de_DE: "Hallo.\\c[4]\nHello.\\c[0]",
  bilingualOriginal: "Hallo.<<C<<Geprüft: X",
  langUid: 1,
};
const plain = { en_US: "Same", de_DE: "Gleich" }; // not merged: always the game's normal text
const early = new ig.LangLabel(label); // created before any switch

assert.strictEqual(ig.LangLabel.getText(label), "Hallo.\\c[4]\nHello.\\c[0]");
press(F9); // primary only
assert.strictEqual(ig.LangLabel.getText(label), "Hallo.");
assert.strictEqual(String(early), "Hallo.", "existing labels follow the switch");
assert.strictEqual(early.value, "Hallo.");
assert.strictEqual(ig.LangLabel.getText(plain), "Gleich");
assert.strictEqual(storage.crossCulturalMode, "1");
assert.match(elements[0].textContent, /Deutsch/);
press(F9); // secondary only
assert.strictEqual(ig.LangLabel.getText(label), "Hello.");
assert.strictEqual(new ig.LangLabel(label).toString(), "Hello.");
press(121); // other keys do nothing
assert.strictEqual(ig.LangLabel.getText(label), "Hello.");
press(F9); // back to both
assert.strictEqual(ig.LangLabel.getText(label), "Hallo.\\c[4]\nHello.\\c[0]");
assert.match(elements[0].textContent, /Deutsch \+ English/);

// ---- Text on screen is redrawn in place ----

const merged = (de, en) => ({ en_US: en, de_DE: de + " \\c[4]" + en + "\\c[0]", bilingualOriginal: de });
const sword = merged("Schwert", "Sword");
const yes = merged("Ja", "Yes");
const notice = { en_US: "Closed.", de_DE: "Zu.\\c[4]\n\nClosed.\\c[0]", bilingualOriginal: "Zu." };
const side = { en_US: "Hi!", de_DE: "Hallo!\\c[4]\nHi!\\c[0]", bilingualOriginal: "Hallo!" };

const root = new Gui();
ig.gui = { guiHooks: [root.hook] };

// Dialogue: an older finished line, a plain string, and the newest line still typing.
const area = new Gui();
area.messages = [];
area.boardMsg = new sc.MsgBoardGui(new ig.LangLabel(notice));
area.addChildGui(area.boardMsg);
root.addChildGui(area);
const older = new sc.MsgBoxGui(200, 2, new ig.LangLabel(label));
older.text.textBlock.finish();
let finishedAgain = 0;
older.text.textBlock.onFinish = () => finishedAgain++;
const fixed = new sc.MsgBoxGui(200, 2, "Plain string");
const typing = new sc.MsgBoxGui(200, 1, new ig.LangLabel(label));
for (const box of [older, fixed, typing]) { area.addChildGui(box); area.messages.push(box); }

// Choices.
const options = [{ label: new ig.LangLabel(yes) }, { label: new ig.LangLabel(merged("Nein", "No")) }];
area.choiceGui = new sc.ChoiceBoxGui(options, 50, 60);
area.choiceGui.delayTimer = 0; // already usable
area.choiceGui.buttonGroup.current = { x: 0, y: 1 };
ig.interact.addEntry(area.choiceGui.buttonInteract);
area.addChildGui(area.choiceGui);
const firstChoice = area.choiceGui;

// Side messages: one on screen, paused with one older message from the history.
const hud = new sc.SideMessageHudGui();
root.addChildGui(hud);
const sideBox = new sc.SideMessageBoxGui(new ig.LangLabel(side));
sideBox.text.textBlock.finish();
sideBox.text.stop();
hud.visibleBoxes.push(sideBox);
hud.addChildGui(sideBox);
const pauseBox = new sc.SideMessageBoxGui(new ig.LangLabel(side));
pauseBox.text.textBlock.finish();
hud.pauseBoxes.push(pauseBox);
hud.addChildGui(pauseBox);

// Plain strings built from labels (an item name in a colour, a menu entry),
// and strings that only contain label text.
const item = new TextGui("\\c[3]" + ig.LangLabel.getText(sword) + "\\c[0]");
const entry = new TextGui(ig.LangLabel.getText(yes));
const sentence = new TextGui("Ja, gerne");
const notLabel = new TextGui("Schwert und Schild");
for (const gui of [item, entry, sentence, notLabel]) root.addChildGui(gui);

const shown = (gui) => gui.textBlock.shown;
assert.strictEqual(shown(older.text), "Hallo.\\c[4]\nHello.\\c[0]");
assert.strictEqual(older.hook.size.y, 28);

press(F9); // primary only
// Dialogue
assert.strictEqual(shown(older.text), "Hallo.");
assert.strictEqual(shown(typing.text), "Hallo.");
assert.strictEqual(shown(fixed.text), "Plain string");
assert.ok(older.text.textBlock.isFinished(), "a finished line stays finished");
assert.strictEqual(finishedAgain, 0, "a finished line does not report finishing again");
assert.ok(!typing.text.textBlock.isFinished(), "a line being typed types again");
assert.strictEqual(older.hook.size.x, 46, "bubble width fits and is even");
assert.strictEqual(older.hook.size.y, 18, "bubble height fits the new text");
assert.strictEqual(fixed.hook.pos.y, typing.hook.size.y + 15, "older lines restack above the newest");
assert.strictEqual(older.hook.pos.y, typing.hook.size.y + 15 + fixed.hook.size.y + 2);
// Notice board
assert.strictEqual(shown(area.boardMsg.content.text), "Zu.");
assert.deepStrictEqual(area.boardMsg.hook.size, { x: 250, y: 36 });
// Choices are rebuilt with the same options, focus and input.
const choice = area.choiceGui;
assert.notStrictEqual(choice, firstChoice, "a new choice box");
assert.strictEqual(firstChoice.hook.parentHook, null, "the old box is gone");
assert.deepStrictEqual(choice.buttons.map(shown), ["\\c[0]Ja", "\\c[0]Nein"]);
assert.strictEqual(choice.hook.currentStateName, "DEFAULT", "shown without the pop-in animation");
assert.strictEqual(choice.delayTimer, 0);
assert.deepStrictEqual(ig.interact.entries, [choice.buttonInteract], "input moves to the new box");
assert.deepStrictEqual(choice.buttonGroup.current, { x: 0, y: 1 }, "focus is kept");
assert.ok(area.hook.children.includes(choice.hook));
assert.strictEqual(area.hook.children.filter((h) => h.gui instanceof sc.ChoiceBoxGui).length, 1);
// Side messages
assert.strictEqual(shown(sideBox.text), "Hallo!");
assert.ok(sideBox.text.textBlock.isFinished());
assert.ok(sideBox.text.stopped, "a paused side message stays paused");
assert.deepStrictEqual(sideBox.hook.size, { x: 163, y: 42 });
assert.strictEqual(sideBox.face.height, 42);
assert.strictEqual(pauseBox.hook.pos.y, 45, "history stacks below the visible messages");
assert.strictEqual(hud.pauseMaxY, 87);
assert.ok(hud.skips > 0);
// Strings
assert.strictEqual(shown(item), "\\c[3]Schwert\\c[0]", "colour codes around a label are kept");
assert.strictEqual(shown(entry), "Ja");
assert.strictEqual(shown(sentence), "Ja, gerne", "label text inside other text is left alone");
assert.strictEqual(shown(notLabel), "Schwert und Schild");

// Text that reads the same in the next mode is not touched (no retyping).
const ok = { en_US: "Ok", de_DE: "Ok \\c[4]Ok\\c[0]", bilingualOriginal: "Ok" };
const same = new TextGui(ig.LangLabel.getText(ok));
let sameSet = 0;
same.setText = function (t) { sameSet++; TextGui.prototype.setText.call(this, t); };
// The same German with different English cannot be traced back: left alone.
const yes2 = merged("Ja", "Yeah");
ig.LangLabel.getText(yes2);
const ambiguous = new TextGui("Ja");
root.addChildGui(same);
root.addChildGui(ambiguous);

press(F9); // secondary only
assert.strictEqual(sameSet, 0);
assert.strictEqual(shown(ambiguous), "Ja");
assert.strictEqual(shown(older.text), "Hello.");
assert.strictEqual(shown(area.boardMsg.content.text), "Closed.");
assert.deepStrictEqual(area.choiceGui.buttons.map(shown), ["\\c[0]Yes", "\\c[0]No"]);
assert.strictEqual(shown(sideBox.text), "Hi!");
assert.strictEqual(shown(item), "\\c[3]Sword\\c[0]");
assert.strictEqual(shown(entry), "Ja", "ambiguous once another label reads the same");
const typingBefore = typing.text.textBlock;
typing.text.textBlock.finish();
press(F9); // both
assert.strictEqual(shown(older.text), "Hallo.\\c[4]\nHello.\\c[0]");
assert.strictEqual(older.hook.size.y, 28);
assert.ok(typingBefore.isFinished(), "a line finished meanwhile stays finished");
assert.strictEqual(shown(area.boardMsg.content.text), "Zu.\\c[4]\n\nClosed.\\c[0]");
assert.deepStrictEqual(area.boardMsg.hook.size, { x: 250, y: 42 });
assert.strictEqual(shown(item), "\\c[3]Schwert \\c[4]Sword\\c[0]\\c[0]");
assert.strictEqual(shown(entry), "Ja");
assert.deepStrictEqual(area.choiceGui.buttons.map(shown), ["\\c[0]Ja \\c[4]Yes\\c[0]", "\\c[0]Nein \\c[4]No\\c[0]"]);
assert.strictEqual(finishedAgain, 0);

// A broken part of the screen does not stop the rest.
const broken = new TextGui(new ig.LangLabel(label));
broken.setText = () => { throw new Error("boom"); };
root.hook.children.unshift(broken.hook);
press(F9);
assert.strictEqual(shown(older.text), "Hallo.");

// ---- Another language selected in the options: the switch stays off ----

ig.currentLang = "ja_JP";
press(F9);
assert.strictEqual(storage.crossCulturalMode, "1");
assert.match(elements[0].textContent, /Select Deutsch/);
assert.strictEqual(ig.LangLabel.getText({ ...label, ja_JP: "こんにちは" }), "こんにちは");

console.log("toggle tests passed");
