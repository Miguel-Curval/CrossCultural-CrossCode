// CrossCultural CrossCode: switch the text language in-game with a key.
// Installed by generate-bilingual-crosscode.py; removed again by --restore.
// Modes: both languages, primary only, secondary only. The choice is remembered.
(function () {
  "use strict";

  var CONFIG = /*CONFIG*/{"primary": "de_DE", "secondary": "en_US", "originalKey": "bilingualOriginal", "keyCode": 120, "keyName": "F9"}/*END*/;
  var STORAGE_KEY = "crossCulturalMode";
  var LANGUAGE_NAMES = {
    en_US: "English", de_DE: "Deutsch", fr_FR: "Français", ja_JP: "日本語",
    ko_KR: "한국어", zh_CN: "简体中文", zh_TW: "繁體中文"
  };

  var mode = 0; // 0 = both, 1 = primary only, 2 = secondary only
  try {
    mode = (parseInt(window.localStorage.getItem(STORAGE_KEY), 10) || 0) % 3;
  } catch (e) { /* storage unavailable: start with both */ }

  function name(lang) { return LANGUAGE_NAMES[lang] || lang; }

  function modeName() {
    if (mode === 1) return name(CONFIG.primary);
    if (mode === 2) return name(CONFIG.secondary);
    return name(CONFIG.primary) + " + " + name(CONFIG.secondary);
  }

  function install() {
    var ig = window.ig;
    if (!ig || !ig.LangLabel || !ig.LangLabel.getText) {
      window.setTimeout(install, 50); // game modules not defined yet
      return;
    }
    var getText = ig.LangLabel.getText;

    ig.LangLabel.getText = function (label, strict) {
      if (mode !== 0 && label && typeof label === "object" &&
          typeof label[CONFIG.originalKey] === "string" && ig.currentLang === CONFIG.primary) {
        var copy = {};
        for (var key in label) copy[key] = label[key];
        copy[CONFIG.primary] = mode === 1 ? label[CONFIG.originalKey] : label[CONFIG.secondary];
        return getText.call(this, copy, strict);
      }
      return getText.apply(this, arguments);
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

    installDialogue();
  }

  // Dialogue boxes on screen: remembered so a switch can redraw them in place.
  var dialogueArea = null;

  function installDialogue() {
    var sc = window.sc;
    if (!sc || !sc.MsgBoxGui || !sc.MsgBoxGui.inject) {
      window.setTimeout(installDialogue, 50);
      return;
    }
    sc.MsgBoxGui.inject({
      init: function (width, pointer, text) {
        this.parent.apply(this, arguments);
        this.bilingualText = text;
        if (this.personEntry && this.personEntry.area) dialogueArea = this.personEntry.area;
      }
    });
  }

  function redrawBox(box) {
    if (!box.bilingualText || typeof box.bilingualText !== "object") return; // plain string: fixed
    var block = box.text.textBlock;
    var finished = block.isFinished();
    var onFinish = block.onFinish;
    block.onFinish = null; // a finished line must not report finishing again
    box.text.setText(box.bilingualText);
    if (finished) block.finish();
    block.onFinish = onFinish; // an unfinished line types again and reports when done

    // Fit the bubble to the new text, as sc.MsgBoxGui and sc.ArrowBoxGui do.
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

  function redrawDialogue() {
    var messages = dialogueArea && dialogueArea.messages;
    if (!messages || !messages.length) return;
    try {
      for (var i = 0; i < messages.length; i++) redrawBox(messages[i]);
      // Restack older lines above the newest one, as the game does for a new line.
      var y = messages[messages.length - 1].hook.size.y + 13 + 2;
      for (var j = messages.length - 2; j >= 0; j--) {
        var box = messages[j];
        box.doPosTranstition(box.hook.pos.x, y, 0.2, window.KEY_SPLINES && window.KEY_SPLINES.EASE_OUT);
        y += box.hook.size.y + 2;
      }
    } catch (e) { /* game internals differ: new lines still follow the switch */ }
  }

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
    mode = (mode + 1) % 3;
    try { window.localStorage.setItem(STORAGE_KEY, String(mode)); } catch (e) { /* not saved */ }
    redrawDialogue();
    showNotice("Text: " + modeName() + "  (" + CONFIG.keyName + ")");
  }, true);

  install();
})();
