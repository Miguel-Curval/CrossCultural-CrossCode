// CrossCultural CrossCode: switch the text language in-game with a key.
// Installed by generate-bilingual-crosscode.py; removed again by --restore.
// Modes: both languages, primary only, secondary only. The choice is remembered,
// and text already on screen is redrawn in the new mode.
(function () {
  "use strict";

  var CONFIG = /*CONFIG*/{"primary": "de_DE", "secondary": "en_US", "originalKey": "bilingualOriginal", "keyCode": 120, "keyName": "F9", "double": true}/*END*/;
  var STORAGE_KEY = "crossCulturalMode";
  var LANGUAGE_NAMES = {
    en_US: "English", de_DE: "Deutsch", fr_FR: "Français", ja_JP: "日本語",
    ko_KR: "한국어", zh_CN: "简体中文", zh_TW: "繁體中文"
  };

  // 0 = both, 1 = primary only, 2 = secondary only. Without the double
  // display, only 1 and 2 are used, starting with the primary language.
  var FIRST_MODE = CONFIG.double === false ? 1 : 0;
  var mode = FIRST_MODE;
  try {
    mode = (parseInt(window.localStorage.getItem(STORAGE_KEY), 10) || 0) % 3;
  } catch (e) { /* storage unavailable: start with the first mode */ }
  if (mode < FIRST_MODE) mode = FIRST_MODE;

  function name(lang) { return LANGUAGE_NAMES[lang] || lang; }

  function modeName() {
    if (mode === 1) return name(CONFIG.primary);
    if (mode === 2) return name(CONFIG.secondary);
    return name(CONFIG.primary) + " + " + name(CONFIG.secondary);
  }

  function isMerged(label) {
    return label && typeof label === "object" && typeof label[CONFIG.originalKey] === "string";
  }

  // ---- Text lookup ---------------------------------------------------------

  var gameGetText = null;
  var seen = typeof WeakMap === "function" ? new WeakMap() : null;
  // Text of every merged label shown so far, in all three modes, so that plain
  // strings already on screen can be traced back to their label.
  var labelsByText = Object.create(null);
  var AMBIGUOUS = {};

  function textIn(label, m) {
    if (m === 0) return gameGetText(label);
    var copy = {};
    for (var key in label) copy[key] = label[key];
    copy[CONFIG.primary] = m === 1 ? label[CONFIG.originalKey] : label[CONFIG.secondary];
    return gameGetText(copy);
  }

  function remember(label) {
    if (!seen || seen.has(label)) return;
    var texts = [textIn(label, 0), textIn(label, 1), textIn(label, 2)];
    seen.set(label, texts);
    for (var i = 0; i < 3; i++) {
      var text = texts[i];
      if (typeof text !== "string" || !text) continue;
      var known = labelsByText[text];
      if (!known) labelsByText[text] = label;
      else if (known !== AMBIGUOUS && known !== label) {
        var other = seen.get(known);
        // Different labels with the same text in every mode are interchangeable.
        if (other[0] !== texts[0] || other[1] !== texts[1] || other[2] !== texts[2]) {
          labelsByText[text] = AMBIGUOUS;
        }
      }
    }
  }

  var LEADING_CODES = /^(?:\\[a-zA-Z]\[[^\]]*\]|\s)+/;
  var TRAILING_CODE = /(?:\\[a-zA-Z]\[[^\]]*\]|\s)$/;

  function findLabel(text) {
    var label = labelsByText[text];
    return label && label !== AMBIGUOUS ? label : null;
  }

  // The new text for a widget that showed `text` in mode `before`: for a
  // label, or a string that is a known label's text (possibly inside colour
  // codes, like a highlighted item name). Null when nothing changes.
  function newText(text, before) {
    if (text && typeof text === "object") {
      var texts = isMerged(text.data) && seen && seen.get(text.data);
      return texts && texts[before] !== texts[mode] ? String(text) : null;
    }
    if (typeof text !== "string" || !text) return null;
    var prefix = (LEADING_CODES.exec(text) || [""])[0];
    var rest = text.slice(prefix.length);
    var label = findLabel(text);
    if (label) prefix = rest = "";
    // Try the text without trailing codes, one code at a time.
    for (var end = rest.length; !label && end > 0;) {
      label = findLabel(rest.slice(0, end));
      if (label) break;
      var match = TRAILING_CODE.exec(rest.slice(0, end));
      if (!match) break;
      end -= match[0].length;
    }
    if (!label) return null;
    var texts2 = seen.get(label);
    if (texts2[before] === texts2[mode]) return null;
    if (!prefix && !rest) return texts2[mode];
    return prefix + texts2[mode] + rest.slice(end);
  }

  function install() {
    var ig = window.ig;
    if (!ig || !ig.LangLabel || !ig.LangLabel.getText) {
      window.setTimeout(install, 50); // game modules not defined yet
      return;
    }
    gameGetText = ig.LangLabel.getText;

    ig.LangLabel.getText = function (label, strict) {
      if (isMerged(label) && ig.currentLang === CONFIG.primary) {
        remember(label);
        if (mode !== 0) {
          var copy = {};
          for (var key in label) copy[key] = label[key];
          copy[CONFIG.primary] = mode === 1 ? label[CONFIG.originalKey] : label[CONFIG.secondary];
          return gameGetText.call(this, copy, strict);
        }
      }
      return gameGetText.apply(this, arguments);
    };

    // Labels store their text once when created; look it up on every use
    // instead, so text created before a switch follows the current mode.
    var proto = ig.LangLabel.prototype;
    Object.defineProperty(proto, "value", {
      configurable: true,
      get: function () { return ig.LangLabel.getText(this.data); },
      set: function () { /* computed */ }
    });
    proto.toString = function () { return ig.LangLabel.getText(this.data); };

    installChoices();
  }

  // Choice boxes are rebuilt on a switch, so they keep what they were made with.
  function installChoices() {
    var sc = window.sc;
    if (!sc || !sc.ChoiceBoxGui || !sc.ChoiceBoxGui.inject) {
      window.setTimeout(installChoices, 50);
      return;
    }
    sc.ChoiceBoxGui.inject({
      init: function () {
        this.bilingualArgs = Array.prototype.slice.call(arguments);
        this.parent.apply(this, arguments);
      }
    });
  }

  // ---- Redrawing text on screen ---------------------------------------------

  function forEachGui(fn) {
    var ig = window.ig;
    var stack = ig.gui && ig.gui.guiHooks ? ig.gui.guiHooks.slice() : [];
    while (stack.length) {
      var hook = stack.pop();
      if (!hook) continue;
      if (hook.gui) fn(hook.gui);
      if (hook.children) for (var i = 0; i < hook.children.length; i++) stack.push(hook.children[i]);
    }
  }

  function isTextGui(gui) { return gui.textBlock && typeof gui.setText === "function"; }

  // Replace a text widget's text. A finished line stays finished without
  // reporting it again; a line being typed starts typing again.
  function setTextKeepState(gui, text) {
    var block = gui.textBlock;
    var finished = block.isFinished();
    var stopped = gui.stopped;
    var onFinish = block.onFinish;
    block.onFinish = null;
    try {
      gui.setText(text);
      if (finished) block.finish();
    } finally {
      block.onFinish = onFinish;
    }
    gui.stopped = stopped;
  }

  function refreshText(gui, before) {
    var text = newText(gui.text, before);
    if (text === null) return false;
    setTextKeepState(gui, typeof gui.text === "object" ? gui.text : text);
    return true;
  }

  // Fit a dialogue bubble to its text, as sc.MsgBoxGui and sc.ArrowBoxGui do.
  function fitDialogueBox(box) {
    var frame = box.box;
    frame.resize(box.text.hook.size.x, box.text.hook.size.y);
    if (frame.hook.size.x % 2 === 1) frame.hook.size.x += 1;
    frame.hook.pivot.x = frame.pointerType > 2 ? frame.hook.size.x : 0;
    frame.hook.pivot.y = frame.hook.size.y;
    box.hook.size.x = frame.hook.size.x;
    box.hook.size.y = frame.hook.size.y;
    box.hook.pivot.x = frame.hook.pivot.x;
    box.hook.pivot.y = frame.hook.pivot.y;
  }

  var EASE = function () { return window.KEY_SPLINES && window.KEY_SPLINES.EASE_OUT; };

  // Dialogue: older lines stack above the newest one, as for a new line.
  function layoutDialogue(area) {
    var messages = area.messages;
    if (!messages.length) return;
    var y = messages[messages.length - 1].hook.size.y + 13 + 2;
    for (var i = messages.length - 2; i >= 0; i--) {
      messages[i].doPosTranstition(messages[i].hook.pos.x, y, 0.2, EASE());
      y += messages[i].hook.size.y + 2;
    }
  }

  // Notice boards and other centred messages: as sc.MsgBoardGui.setContent.
  function layoutBoard(board) {
    var content = board.content;
    var size = content.text.hook.size;
    content.setSize(size.x, size.y);
    var minWidth = 250;
    var details = window.ig.LANG_DETAILS && window.ig.LANG_DETAILS[window.ig.currentLang];
    if (details && details.fixedMsgWidth) minWidth = 220;
    var width = Math.max(minWidth, size.x + 20);
    var height = Math.max(36, size.y + 12);
    content.setPos((width - size.x) / 2, (height - size.y) / 2);
    board.setSize(width, height);
  }

  // Side messages: size as sc.SideMessageBoxGui.setContent, stack as the HUD does.
  function fitSideMessage(box) {
    var width = (box.text.hook.size.x < 101 ? 101 : 202) + 62;
    var height = Math.max(42, box.text.hook.size.y + 4);
    box.setSize(width, height);
    if (box.face) box.face.setFace(box.face.charExpression, height);
  }

  function layoutSideMessages(hud) {
    var y = 0;
    for (var i = hud.visibleBoxes.length; i--;) {
      hud.visibleBoxes[i].doPosTranstition(0, y, 0.2, EASE());
      y += hud.visibleBoxes[i].hook.size.y + 3;
    }
    for (var j = 0; j < hud.pauseBoxes.length; j++) {
      hud.pauseBoxes[j].setPos(0, y);
      y += hud.pauseBoxes[j].hook.size.y + 3;
    }
    if (hud.pauseBoxes.length) hud.pauseMaxY = y - 3;
    if (hud.updateSkipGui) hud.updateSkipGui();
  }

  // Choices: build the box again from the same options, in place.
  function rebuildChoices(area) {
    var sc = window.sc, ig = window.ig;
    var old = area.choiceGui;
    if (!old || !old.bilingualArgs || old.hook.removeAfterTransition || !old.hook.parentHook) return;
    var Choice = sc.ChoiceBoxGui;
    var fresh = new (Function.prototype.bind.apply(Choice, [null].concat(old.bilingualArgs)))();
    fresh.doStateTransition("DEFAULT", true);
    ig.interact.removeEntry(old.buttonInteract);
    area.removeChildGui(old);
    area.addChildGui(fresh);
    area.choiceGui = fresh;
    if (old.delayTimer) {
      fresh.delayTimer = old.delayTimer;
    } else {
      fresh.delayTimer = 0;
      ig.interact.addEntry(fresh.buttonInteract);
    }
    var current = old.buttonGroup && old.buttonGroup.current;
    if (current && fresh.buttonGroup.setCurrentFocus) {
      try { fresh.buttonGroup.setCurrentFocus(current.x, current.y); } catch (e) { /* keep default */ }
    }
  }

  function step(fn, arg) {
    try { fn(arg); } catch (e) { /* game internals differ: new text still follows */ }
  }

  function redrawScreen(before) {
    var sc = window.sc || {};
    var changed = [];
    var areas = [], boards = [], huds = [];
    forEachGui(function (gui) {
      if (isTextGui(gui)) {
        try { if (refreshText(gui, before)) changed.push(gui); } catch (e) { /* skip this one */ }
      }
      if (Array.isArray(gui.messages) && gui.boardMsg) areas.push(gui);
      if (sc.MsgBoardGui && gui instanceof sc.MsgBoardGui) boards.push(gui);
      if (sc.SideMessageHudGui && gui instanceof sc.SideMessageHudGui) huds.push(gui);
    });
    forEachGui(function (gui) {
      if (sc.MsgBoxGui && gui instanceof sc.MsgBoxGui) step(fitDialogueBox, gui);
      else if (sc.SideMessageBoxGui && gui instanceof sc.SideMessageBoxGui) step(fitSideMessage, gui);
    });
    areas.forEach(function (area) { step(layoutDialogue, area); step(rebuildChoices, area); });
    boards.forEach(function (board) {
      if (board.hook.currentStateName !== "HIDDEN") step(layoutBoard, board);
    });
    huds.forEach(function (hud) { step(layoutSideMessages, hud); });
    return changed.length;
  }

  // ---- Key and notice -----------------------------------------------------

  var notice = null, hideTimer = null;

  function showNotice(text) {
    if (!notice) {
      notice = document.createElement("div");
      notice.style.cssText = [
        "position:fixed", "top:12px", "left:50%", "transform:translateX(-50%)",
        "z-index:2147483647", "pointer-events:none", "padding:6px 14px",
        "background:rgba(0,0,0,0.8)", "color:#fff", "border:1px solid #8C8C8C",
        "border-radius:4px", "font:bold 14px sans-serif", "transition:opacity 0.3s",
        "opacity:0"
      ].join(";");
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.style.opacity = "1";
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () { notice.style.opacity = "0"; }, 1600);
  }

  window.addEventListener("keydown", function (event) {
    if (event.keyCode !== CONFIG.keyCode || event.repeat) return;
    event.preventDefault();
    if (window.ig && window.ig.currentLang && window.ig.currentLang !== CONFIG.primary) {
      showNotice("Select " + name(CONFIG.primary) + " in the options to use " + CONFIG.keyName);
      return;
    }
    var before = mode;
    mode = mode + 1 > 2 ? FIRST_MODE : mode + 1;
    try { window.localStorage.setItem(STORAGE_KEY, String(mode)); } catch (e) { /* not saved */ }
    if (gameGetText) {
      try { redrawScreen(before); } catch (e) { /* new text still follows the switch */ }
    }
    showNotice("Text: " + modeName() + "  (" + CONFIG.keyName + ")");
  }, true);

  install();
})();
