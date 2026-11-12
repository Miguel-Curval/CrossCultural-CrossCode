"""Tests for generate-bilingual-crosscode.py. Run with: python -m unittest"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import time
import struct
import unittest
import zlib
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "generate-bilingual-crosscode.py"
spec = importlib.util.spec_from_file_location("bilingual", SCRIPT)
bl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bl)

MAP = {
    "name": "test/map",
    "entities": [{
        "type": "NPC",
        "settings": {"event": [
            {"type": "SHOW_MSG", "message": {
                "en_US": "Hello.", "de_DE": "Hallo.<<C<<Geprüft: X", "fr_FR": "fr_FR", "langUid": 1}},
            {"type": "SHOW_CHOICE", "options": [
                {"label": {"en_US": "Yes", "de_DE": "Ja<<A<<[CHANGED 2018/01/01]", "langUid": 2}}]},
            {"type": "SHOW_MSG", "message": {"en_US": "Same", "de_DE": "Same", "langUid": 3}},
        ]},
    }],
}
DATABASE = {"commonEvents": {"e": {"event": [
    {"type": "SHOW_MSG", "message": {"en_US": "Hi there.", "de_DE": "\\c[3]Hallo!", "langUid": 4}},
]}}}


def make_png(pixels, filters):
    """Encode RGBA rows (lists of 4-tuples) using the given PNG filter per row."""
    height, width = len(pixels), len(pixels[0])
    raw, prev = bytearray(), bytes(width * 4)
    for row, kind in zip(pixels, filters):
        line = bytes(v for px in row for v in px)
        if kind == 1:
            enc = bytes((line[i] - (line[i - 4] if i >= 4 else 0)) & 0xFF for i in range(len(line)))
        elif kind == 2:
            enc = bytes((line[i] - prev[i]) & 0xFF for i in range(len(line)))
        else:
            enc = line
        raw += bytes([kind]) + enc
        prev = line
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))


def png_pixels(data):
    chunks = dict(bl._png_chunks(data))
    width, height = struct.unpack(">II", chunks[b"IHDR"][:8])
    rows = bl._unfilter(zlib.decompress(chunks[b"IDAT"]), width, height)
    return [[tuple(r[i:i + 4]) for i in range(0, len(r), 4)] for r in rows]


GREY, BLACK, CLEAR = (128, 128, 128, 255), (0, 0, 0, 255), (128, 128, 128, 0)
FONT = make_png([[GREY, BLACK, CLEAR], [BLACK, GREY, GREY]], [1, 2])


def run(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            code = bl.main([str(a) for a in args])
        except SystemExit as e:
            code = e.code
    return code, out.getvalue()


class TextTests(unittest.TestCase):
    def test_clean_text_cuts_at_note_like_the_game(self):
        self.assertEqual(bl.clean_text("Hallo<<C<<Geprüft: Minsu"), "Hallo")
        self.assertEqual(bl.clean_text("Hi<<A<<[CHANGED 2017/01/01] "), "Hi")
        self.assertEqual(bl.clean_text("A<<A<<x<<C<<y"), "A<<A<<x")  # <<C<< wins
        self.assertEqual(bl.clean_text("\nKeep leading  "), "\nKeep leading")

    def test_label_text_treats_placeholders_as_missing(self):
        label = {"en_US": "Hi", "fr_FR": "fr_FR", "de_DE": "  <<C<<x", "langUid": 1}
        self.assertEqual(bl.label_text(label, "en_US"), "Hi")
        self.assertIsNone(bl.label_text(label, "fr_FR"))
        self.assertIsNone(bl.label_text(label, "de_DE"))
        self.assertIsNone(bl.label_text(label, "ja_JP"))

    def test_combine_closes_open_color_and_orders(self):
        self.assertEqual(bl.combine("\\c[3]Rot", "Red", "\n", False), "\\c[3]Rot\\c[0]\nRed")
        self.assertEqual(bl.combine("\\c[3]Rot\\c[0]", "Red", "\n", False), "\\c[3]Rot\\c[0]\nRed")
        self.assertEqual(bl.combine("Ja", "Yes", " / ", True), "Yes / Ja")

    def test_code_only_text_is_not_merged(self):
        data = {"type": "SHOW_GET_MSG", "object": {"en_US": "\\v[item.225.name]", "de_DE": "Blaue Eisform"}}
        self.assertEqual(bl.merge_labels(data, "de_DE", "en_US", "\n", " / ", False), 0)
        self.assertEqual(data["object"]["de_DE"], "Blaue Eisform")

    def test_tasks_stay_on_one_line(self):
        data = {"type": "SET_TASK", "task": {"en_US": "Enter the mine.", "de_DE": "Betritt die Mine."}}
        bl.merge_labels(data, "de_DE", "en_US", "\n-----\n", " / ", False)
        self.assertEqual(data["task"]["de_DE"], "Betritt die Mine. / Enter the mine.")

    def test_secondary_color_keeps_highlights(self):
        self.assertEqual(
            bl.combine("Schau, \\c[3]Eis\\c[0].", "Look, \\c[3]ice\\c[0].", "\n", False, 4),
            "Schau, \\c[3]Eis\\c[0].\\c[4]\nLook, \\c[3]ice\\c[4].\\c[0]")
        self.assertEqual(bl.combine("Hallo.", "Hi.", "\n", True, 4), "\\c[4]Hi.\\c[0]\nHallo.")
        data = {"options": [{"label": {"en_US": "Yes", "de_DE": "Ja"}}]}
        bl.merge_labels(data, "de_DE", "en_US", "\n~ ", " ~ ", False, 4)
        self.assertEqual(data["options"][0]["label"]["de_DE"], "Ja\\c[4] ~ Yes\\c[0]")

    def test_text_with_paragraphs_gets_a_blank_line(self):
        data = {"text": {"en_US": "One.\n\nTwo.", "de_DE": "Eins.\n\nZwei."},
                "message": {"en_US": "Hi.\nYou.", "de_DE": "Hallo.\nDu."}}
        bl.merge_labels(data, "de_DE", "en_US", "\n", " ", False, 4, "\n\n")
        self.assertEqual(data["text"]["de_DE"], "Eins.\n\nZwei.\\c[4]\n\nOne.\n\nTwo.\\c[0]")
        self.assertEqual(data["message"]["de_DE"], "Hallo.\nDu.\\c[4]\nHi.\nYou.\\c[0]")

    def test_recolor_png(self):
        out = bl.recolor_png(FONT, (128, 128, 128), (140, 140, 140))
        G = (140, 140, 140, 255)
        self.assertEqual(png_pixels(out), [[G, BLACK, (140, 140, 140, 0)], [BLACK, G, G]])
        with self.assertRaises(ValueError):
            bl.recolor_png(b"not a png", (0, 0, 0), (1, 1, 1))

    def test_merge_labels(self):
        data = json.loads(json.dumps(MAP))
        self.assertEqual(bl.merge_labels(data, "de_DE", "en_US", "\n", " / ", False), 2)
        events = data["entities"][0]["settings"]["event"]
        self.assertEqual(events[0]["message"]["de_DE"], "Hallo.\nHello.")
        self.assertEqual(events[1]["options"][0]["label"]["de_DE"], "Ja / Yes")
        self.assertEqual(events[2]["message"]["de_DE"], "Same")
        # Placeholder secondary: nothing to merge.
        data = json.loads(json.dumps(MAP))
        self.assertEqual(bl.merge_labels(data, "de_DE", "fr_FR", "\n", " / ", False), 0)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.install = self.tmp / "CrossCode"
        self.map = self.install / "assets/data/maps/test/map.json"
        self.db = self.install / "assets/data/database.json"
        self.lang = self.install / "assets/data/lang/sc/gui.de_DE.json"
        self.copy = self.install / "assets/data/maps - Copy/test/map.json"
        for path, data in ((self.map, MAP), (self.db, DATABASE), (self.lang, MAP), (self.copy, MAP)):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(MAP if data is MAP else data, separators=(",", ":")), "utf-8")
        self.font = self.install / bl.GREY_FONT_IMAGES[0]
        self.font.parent.mkdir(parents=True)
        self.font.write_bytes(FONT)
        self.originals = self.snapshot()

    def snapshot(self):
        return {p.relative_to(self.install).as_posix(): p.read_bytes()
                for p in self.install.rglob("*") if p.is_file() and bl.BACKUP_DIR_NAME not in p.parts}

    def message(self, path=None):
        data = json.loads((path or self.map).read_text("utf-8"))
        return data["entities"][0]["settings"]["event"][0]["message"]["de_DE"]

    def test_in_place_run_rerun_and_restore(self):
        code, out = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.message(), "Hallo.\\c[4]\nHello.\\c[0]")
        db = json.loads(self.db.read_text("utf-8"))
        self.assertEqual(db["commonEvents"]["e"]["event"][0]["message"]["de_DE"],
                         "\\c[3]Hallo!\\c[0]\\c[4]\nHi there.\\c[0]")
        # Language files and user copies are left alone.
        self.assertEqual(self.lang.read_bytes(), self.originals["assets/data/lang/sc/gui.de_DE.json"])
        self.assertEqual(self.copy.read_bytes(), self.originals["assets/data/maps - Copy/test/map.json"])

        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertEqual(self.message(), "Hallo.\\c[4]\nHello.\\c[0]")  # not doubled

        code, out = run("--install-dir", self.install, "--restore")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.snapshot(), self.originals)
        self.assertFalse((self.install / bl.BACKUP_DIR_NAME).exists())

    def test_switching_languages_reverts_files_without_matches(self):
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        code, _ = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "fr_FR")
        self.assertEqual(code, 1)  # nothing to merge: fr_FR is only a placeholder here
        json_only = lambda files: {k: v for k, v in files.items() if k.endswith(".json")}
        self.assertEqual(json_only(self.snapshot()), json_only(self.originals))

    def test_game_update_refreshes_backup(self):
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        updated = json.loads(json.dumps(MAP))
        updated["entities"][0]["settings"]["event"][0]["message"]["de_DE"] = "Neu."
        self.map.write_text(json.dumps(updated), "utf-8")
        future = time.time() + 10
        os.utime(self.map, (future, future))
        code, out = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertIn("refreshing backup", out)
        self.assertEqual(self.message(), "Neu.\\c[4]\nHello.\\c[0]")

    def test_legacy_maps_backup_is_adopted(self):
        legacy = self.install / bl.LEGACY_BACKUP
        shutil.copytree(self.map.parent.parent, legacy)
        self.map.write_text(json.dumps({"broken by": "old script"}), "utf-8")  # modified live map
        code, out = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertEqual(code, 0, out)
        self.assertFalse(legacy.exists())
        self.assertEqual(self.message(), "Hallo.\\c[4]\nHello.\\c[0]")
        run("--install-dir", self.install, "--restore")
        self.assertEqual(self.snapshot(), self.originals)

    def test_without_color_separators_mark_the_languages(self):
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US",
            "--secondary-color", "none")
        self.assertEqual(self.message(), "Hallo.\n~ Hello.")
        data = json.loads(self.map.read_text("utf-8"))
        label = data["entities"][0]["settings"]["event"][1]["options"][0]["label"]["de_DE"]
        self.assertEqual(label, "Ja ~ Yes")

    def test_colored_short_labels_use_a_space(self):
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        data = json.loads(self.map.read_text("utf-8"))
        label = data["entities"][0]["settings"]["event"][1]["options"][0]["label"]["de_DE"]
        self.assertEqual(label, "Ja\\c[4] Yes\\c[0]")

    def test_grey_font_shade(self):
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertEqual(png_pixels(self.font.read_bytes())[0][0], (0x8C, 0x8C, 0x8C, 255))
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US",
            "--grey-shade", "#999999")
        self.assertEqual(png_pixels(self.font.read_bytes())[0][0], (0x99, 0x99, 0x99, 255))
        # Not using grey: the game's font is put back.
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US",
            "--secondary-color", "orange")
        self.assertEqual(self.font.read_bytes(), FONT)
        run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        run("--install-dir", self.install, "--restore")
        self.assertEqual(self.snapshot(), self.originals)
        code, _ = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary",
                      "en_US", "--grey-shade", "grey")
        self.assertEqual(code, 2)

    def test_output_dir_leaves_install_untouched(self):
        out_dir = self.tmp / "out" / "nested"
        code, out = run("--install-dir", self.install, "--lang-primary", "de_DE",
                        "--lang-secondary", "en_US", "--output-dir", out_dir)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.message(out_dir / "assets/data/maps/test/map.json"), "Hallo.\\c[4]\nHello.\\c[0]")
        self.assertEqual(self.snapshot(), self.originals)
        self.assertFalse((self.install / bl.BACKUP_DIR_NAME).exists())

    def test_invalid_arguments(self):
        code, out = run("--install-dir", self.install, "--lang-primary", "de_DE", "--lang-secondary", "de_DE")
        self.assertEqual(code, 2)
        code, out = run("--install-dir", self.tmp, "--lang-primary", "de_DE", "--lang-secondary", "en_US")
        self.assertIn("no CrossCode installation", str(code) + out)


if __name__ == "__main__":
    unittest.main()
