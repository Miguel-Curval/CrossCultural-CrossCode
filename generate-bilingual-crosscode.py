#!/usr/bin/env python3
"""Create bilingual text for CrossCode by merging two languages into one.

The game stores translatable text as "lang labels": JSON objects such as
{"en_US": "Hi.", "de_DE": "Hallo.", "langUid": 12}. This script rewrites the
primary language's entry of every lang label to contain both languages, so
selecting the primary language in the game shows both.

By default the game files are modified in place. Pristine copies are kept in
<install-dir>/bilingual-backup and every run starts from them, so the script
can be re-run with other settings or reverted with --restore.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import zlib
from pathlib import Path

BACKUP_DIR_NAME = "bilingual-backup"
STATE_FILE_NAME = "state.json"
STATE_VERSION = 1
# Backup folder written by the first version of this script (maps only).
LEGACY_BACKUP = Path("assets/data/maps_backup")

# The game hides everything after these translator note markers
# (see ig.Lang in assets/js/game.compiled.js). <<C<< is checked first.
NOTE_MARKERS = ("<<C<<", "<<A<<")

# Keys whose labels are short UI strings (names, titles, choice buttons) or
# sit in small boxes (the current task). These are joined with the short
# separator instead of a line break.
SHORT_KEYS = frozenset({
    "label", "name", "names", "title", "displayName", "teleportLabel",
    "hoverText", "species", "person", "taskTitle", "titleText", "header",
    "object", "creator", "value", "task",
})

# Font color numbers for \\c[n] (sc.FONT_COLORS in the game; 3 is drawn yellow).
FONT_COLORS = {"none": None, "red": 1, "green": 2, "yellow": 3, "grey": 4, "orange": 5}

# Font images for \\c[4] (grey) in the three font sizes, drawn in #808080.
GREY_FONT_IMAGES = [Path("assets/media/font/colors") / name for name in (
    "hall-fetica-bold-grey.png", "hall-fetica-small-grey.png", "tiny-grey.png")]
GAME_GREY = (0x80, 0x80, 0x80)
DEFAULT_GREY_SHADE = "8C8C8C"
HEX_COLOR_RE = re.compile(r"^#?[0-9A-Fa-f]{6}$")

LANG_CODE_RE = re.compile(r"^[a-z]{2}_[A-Z]{2}$")
COLOR_CODE_RE = re.compile(r"\\c\[(\d+)\]")
BLANK_LINE_RE = re.compile(r"\n[ \t]*\n")
# Text codes that are not words: variables, colors, icons, pauses, speed.
TEXT_CODE_RE = re.compile(r"\\[a-z]\[[^\]]*\]|\\.")
# Game data folders all use kebab-case names. Anything else (for example a
# manual "maps - Copy" folder) is a user copy that must not be touched.
GAME_DIR_RE = re.compile(r"^[a-z0-9-]+$")
SKIPPED_DATA_DIRS = frozenset({"lang", "maps_backup"})

MTIME_TOLERANCE = 2.0  # seconds; some file systems round timestamps


# ---------------------------------------------------------------------------
# Text merging
# ---------------------------------------------------------------------------

def clean_text(text):
    """Return the text the game would display: notes removed, right-trimmed."""
    for marker in NOTE_MARKERS:
        index = text.find(marker)
        if index != -1:
            text = text[:index]
            break
    return text.rstrip()


def label_text(label, lang):
    """Return the displayable text of `lang` in a lang label, or None.

    Mirrors ig.LangLabel.getText: a missing or empty value, or a value equal
    to the language code itself (a placeholder), counts as untranslated.
    """
    value = label.get(lang)
    if not isinstance(value, str):
        return None
    text = clean_text(value)
    if not text.strip() or text == lang:
        return None
    return text


def has_words(text):
    """False for text made only of codes such as \\v[item.225.name].

    A variable already shows its value in both languages once the label it
    points to is merged, so merging such text would print it twice.
    """
    return any(ch.isalnum() for ch in TEXT_CODE_RE.sub("", text))


def has_open_color(text):
    """True if the text switches to a color (\\c[n]) without resetting it."""
    codes = COLOR_CODE_RE.findall(text)
    return bool(codes) and codes[-1] != "0"


def colorize(text, color):
    """Draw text in a font color. Its own resets (\\c[0]) return to that color."""
    return f"\\c[{color}]{text.replace(chr(92) + 'c[0]', f'{chr(92)}c[{color}]')}\\c[0]"


def combine(primary, secondary, separator, secondary_first, secondary_color=None):
    """Join both texts. The separator belongs to the line that follows it."""
    if secondary_first:
        first, rest = secondary.strip(), separator + primary.lstrip()
        if secondary_color:
            first = colorize(first, secondary_color)
    else:
        first, rest = primary, separator + secondary.lstrip()
        if secondary_color:
            rest = colorize(rest, secondary_color)
    if has_open_color(first):
        first += "\\c[0]"  # keep the first language's color off the second
    return first + rest


def merge_labels(data, primary, secondary, separator, short_separator, secondary_first,
                 secondary_color=None, paragraph_separator=None):
    """Merge `secondary` into `primary` in every lang label inside `data`.

    `paragraph_separator` replaces `separator` for text that already has
    blank lines, so the second language reads as its own block.

    `secondary_color` is a font color number for the secondary language.

    Modifies `data` in place and returns the number of labels changed.
    """
    changed = 0
    # Iterative walk: (node, key of the property holding it)
    stack = [(data, None)]
    while stack:
        node, key = stack.pop()
        if isinstance(node, dict):
            primary_text = label_text(node, primary)
            secondary_text = label_text(node, secondary)
            if (primary_text and secondary_text and primary_text != secondary_text
                    and has_words(primary_text) and has_words(secondary_text)):
                if key in SHORT_KEYS:
                    sep = short_separator
                elif paragraph_separator and (BLANK_LINE_RE.search(primary_text)
                                              or BLANK_LINE_RE.search(secondary_text)):
                    sep = paragraph_separator
                else:
                    sep = separator
                node[primary] = combine(primary_text, secondary_text, sep, secondary_first,
                                        secondary_color)
                changed += 1
            stack.extend((value, k) for k, value in node.items()
                         if isinstance(value, (dict, list)))
        elif isinstance(node, list):
            stack.extend((item, key) for item in node if isinstance(item, (dict, list)))
    return changed


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def dump_json(data):
    # Compact output, like the original game files.
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------------------
# Font recoloring (standard library only)
# ---------------------------------------------------------------------------

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_chunks(data):
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    pos = len(PNG_SIGNATURE)
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        yield kind, data[pos + 8:pos + 8 + length]
        pos += 12 + length


def _png_chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def _unfilter(raw, width, height, bpp=4):
    """Undo PNG row filters; returns the rows of raw pixel bytes."""
    stride = width * bpp
    rows, prev, pos = [], bytearray(stride), 0
    for _ in range(height):
        kind, line = raw[pos], bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            left = line[i - bpp] if i >= bpp else 0
            up = prev[i]
            if kind == 1:
                line[i] = (line[i] + left) & 0xFF
            elif kind == 2:
                line[i] = (line[i] + up) & 0xFF
            elif kind == 3:
                line[i] = (line[i] + ((left + up) >> 1)) & 0xFF
            elif kind == 4:
                up_left = prev[i - bpp] if i >= bpp else 0
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                pred = left if pa <= pb and pa <= pc else (up if pb <= pc else up_left)
                line[i] = (line[i] + pred) & 0xFF
            elif kind != 0:
                raise ValueError(f"bad PNG filter type {kind}")
        rows.append(line)
        prev = line
    return rows


def recolor_png(data, old_rgb, new_rgb):
    """Return the PNG with every pixel of color old_rgb changed to new_rgb.

    Supports 8-bit RGBA, non-interlaced PNGs (the format of the game's fonts).
    Other chunks, such as color profiles, are kept unchanged.
    """
    chunks = list(_png_chunks(data))
    width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    if (depth, color_type, interlace) != (8, 6, 0):
        raise ValueError("only 8-bit RGBA non-interlaced PNGs are supported")
    raw = zlib.decompress(b"".join(body for kind, body in chunks if kind == b"IDAT"))
    old, new = bytes(old_rgb), bytes(new_rgb)
    out = bytearray()
    for line in _unfilter(raw, width, height):
        for i in range(0, len(line), 4):
            if line[i:i + 3] == old:
                line[i:i + 3] = new
        out += b"\x00" + line
    result, idat_written = bytearray(PNG_SIGNATURE), False
    for kind, body in chunks:
        if kind == b"IDAT":
            if not idat_written:
                result += _png_chunk(b"IDAT", zlib.compress(bytes(out), 9))
                idat_written = True
        else:
            result += _png_chunk(kind, body)
    return bytes(result)


def parse_hex_color(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------------------
# File handling
# ---------------------------------------------------------------------------

def atomic_write(path, payload):
    """Write bytes so that an interruption never leaves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(payload)
    os.replace(tmp, path)


def atomic_copy(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def file_stamp(path):
    st = path.stat()
    return [st.st_size, st.st_mtime]


def same_stamp(a, b):
    return a is not None and b is not None and a[0] == b[0] and abs(a[1] - b[1]) < MTIME_TOLERANCE


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_game_files(install_dir, maps_only):
    """Return paths (relative to install_dir) of all JSON files to process."""
    data_dir = install_dir / "assets" / "data"
    if maps_only:
        roots = [data_dir / "maps"]
    else:
        roots = [d for d in sorted(data_dir.iterdir())
                 if d.is_dir() and GAME_DIR_RE.match(d.name) and d.name not in SKIPPED_DATA_DIRS]
        extension_dir = install_dir / "assets" / "extension"
        if extension_dir.is_dir():
            roots += sorted(d / "data" for d in extension_dir.iterdir() if (d / "data").is_dir())

    files = []
    for root in roots:
        files += [p.relative_to(install_dir) for p in root.rglob("*.json")]
    if not maps_only:
        files += [p.relative_to(install_dir) for p in data_dir.glob("*.json")]
    return sorted(set(files))


class Backup:
    """Pristine copies of game files plus a record of what this script wrote."""

    def __init__(self, install_dir):
        self.install_dir = install_dir
        self.dir = install_dir / BACKUP_DIR_NAME
        self.state_path = self.dir / STATE_FILE_NAME
        self.state = {"version": STATE_VERSION, "in_progress": False, "outputs": {}}
        # Only refresh backups from live files when we know exactly which
        # live files we wrote. Otherwise a modified file could be mistaken
        # for a game update and overwrite the pristine copy.
        self.trust_live_changes = False
        if self.state_path.exists():
            self.state = load_json(self.state_path)
            self.trust_live_changes = not self.state.get("in_progress", False)
            if not self.trust_live_changes:
                print("Note: the previous run was interrupted; using existing backups as-is.")

    @property
    def outputs(self):
        return self.state["outputs"]

    def save_state(self):
        atomic_write(self.state_path, json.dumps(self.state, indent=1).encode("utf-8"))

    def migrate_legacy(self):
        """Adopt the maps_backup folder created by the old version of this script."""
        legacy = self.install_dir / LEGACY_BACKUP
        target = self.dir / "assets" / "data" / "maps"
        if not legacy.is_dir() or target.exists():
            return
        live_count = sum(1 for _ in (self.install_dir / "assets" / "data" / "maps").rglob("*.json"))
        legacy_count = sum(1 for _ in legacy.rglob("*.json"))
        if legacy_count != live_count:
            sys.exit(
                f"Error: the old backup {legacy} has {legacy_count} map files but the game has "
                f"{live_count}.\nIt may be incomplete. Restore the original game files (verify/repair "
                f"the game in Steam or GOG), delete {legacy}, then run this script again.")
        print(f"Moving old backup {legacy} to {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(legacy), str(target))

    def source_for(self, rel):
        """Ensure a pristine backup of `rel` exists and return its path."""
        live = self.install_dir / rel
        backup = self.dir / rel
        if not backup.exists():
            atomic_copy(live, backup)
            return backup

        recorded = self.outputs.get(rel.as_posix())
        live_stamp = file_stamp(live)
        if self.trust_live_changes:
            if recorded is not None:
                changed = not same_stamp(live_stamp, recorded)
            else:
                changed = not same_stamp(live_stamp, file_stamp(backup))
            # Timestamps differ but the content may not (e.g. copied files).
            if changed and file_digest(live) != file_digest(backup):
                print(f"\nGame file changed since last run (game update?), refreshing backup: {rel}")
                atomic_copy(live, backup)
                self.outputs.pop(rel.as_posix(), None)
        return backup

    def restore(self):
        files = [p for p in self.dir.rglob("*") if p.is_file() and p != self.state_path]
        for backup in files:
            atomic_copy(backup, self.install_dir / backup.relative_to(self.dir))
        shutil.rmtree(self.dir)
        return len(files)


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def unescape(value):
    return value.replace(r"\n", "\n").replace(r"\t", "\t")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Create bilingual text for CrossCode.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # German text with English below it (select German in the game)
  %(prog)s --install-dir "/path/to/CrossCode" --lang-primary de_DE --lang-secondary en_US

  # English above German
  %(prog)s --install-dir . --lang-primary de_DE --lang-secondary en_US --secondary-first

  # Undo all changes
  %(prog)s --install-dir . --restore
""")
    parser.add_argument("--install-dir", default=".", type=Path,
                        help='CrossCode installation folder (the one containing "assets")')
    parser.add_argument("--lang-primary", help="Language to overwrite and select in the game, e.g. de_DE")
    parser.add_argument("--lang-secondary", help="Language to add to it, e.g. en_US")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Write changed files here (same layout as the install folder) "
                             "instead of modifying the game")
    parser.add_argument("--separator", default=None,
                        help=r'Separator for dialogue and longer text (default: a line break, or a '
                             r'blank line for text with paragraphs; "~ " is added with --secondary-color none)')
    parser.add_argument("--short-separator", "--choice-separator", dest="short_separator", default=None,
                        help='Separator for short labels such as choices and names (default: a space; '
                             '" ~ " with --secondary-color none)')
    parser.add_argument("--secondary-first", action="store_true",
                        help="Put the secondary language before the primary one")
    parser.add_argument("--secondary-color", choices=list(FONT_COLORS), default="grey",
                        help="Font color of the secondary language (default: grey)")
    parser.add_argument("--grey-shade", default=DEFAULT_GREY_SHADE, metavar="HEX",
                        help=f"Shade of the grey font, e.g. 8C8C8C (default: {DEFAULT_GREY_SHADE}; the "
                             "game's own is 808080). Also brightens the few game texts that use grey.")
    parser.add_argument("--maps-only", action="store_true",
                        help="Only process map files (the original behaviour); skips the common "
                             "events in database.json, items, enemies, DLC, etc.")
    parser.add_argument("--restore", action="store_true",
                        help="Restore the original game files from the backup and exit")
    args = parser.parse_args(argv)

    if not args.restore:
        for name in ("lang_primary", "lang_secondary"):
            value = getattr(args, name)
            if not value:
                parser.error(f"--{name.replace('_', '-')} is required")
            if not LANG_CODE_RE.match(value):
                parser.error(f"invalid language code {value!r} (expected something like de_DE)")
        if args.lang_primary == args.lang_secondary:
            parser.error("--lang-primary and --lang-secondary must be different")
    # The color tells the languages apart; a visible marker is only needed without it.
    colored = FONT_COLORS[args.secondary_color] is not None
    if args.separator is None:
        args.separator = r"\n" if colored else r"\n~ "
        args.paragraph_separator = r"\n\n" if colored else r"\n\n~ "
    else:
        args.paragraph_separator = args.separator  # a custom separator is used as given
    if args.short_separator is None:
        args.short_separator = " " if colored else " ~ "
    if not HEX_COLOR_RE.match(args.grey_shade):
        parser.error(f"invalid --grey-shade {args.grey_shade!r} (expected something like 8C8C8C)")
    args.separator = unescape(args.separator)
    args.paragraph_separator = unescape(args.paragraph_separator)
    args.short_separator = unescape(args.short_separator)
    return args


def pristine_source(install_dir, backup, rel):
    """For --output-dir: read the original file even if the game was modified before."""
    candidates = [backup.dir / rel]
    maps = Path("assets/data/maps")
    if rel.is_relative_to(maps):
        candidates.append(install_dir / LEGACY_BACKUP / rel.relative_to(maps))
    return next((p for p in candidates if p.exists()), install_dir / rel)


def print_progress(text):
    if sys.stdout.isatty():
        width = shutil.get_terminal_size().columns - 1
        print("\r" + text[:width].ljust(width), end="", flush=True)


def main(argv=None):
    args = parse_args(argv)
    install_dir = args.install_dir.resolve()
    if not (install_dir / "assets" / "data" / "maps").is_dir():
        sys.exit(f"Error: no CrossCode installation found at {install_dir}\n"
                 "Point --install-dir at the folder that contains the 'assets' folder.")

    backup = Backup(install_dir)
    in_place = args.output_dir is None
    if in_place or args.restore:
        backup.migrate_legacy()

    if args.restore:
        if not backup.dir.exists():
            sys.exit(f"Nothing to restore: no backup found at {backup.dir}")
        count = backup.restore()
        print(f"Restored {count} original files and removed {backup.dir}")
        return 0

    files = find_game_files(install_dir, args.maps_only)

    print("=" * 60)
    print("CrossCode Bilingual Generator")
    print(f"Mode:      {'modify game files (backup: ' + str(backup.dir) + ')' if in_place else 'write to ' + str(args.output_dir)}")
    print(f"Languages: {args.lang_primary} + {args.lang_secondary}")
    print(f"Order:     {'secondary, primary' if args.secondary_first else 'primary, secondary'}")
    print(f"Color:     {args.secondary_color} (secondary language)"
          + (f", shade #{args.grey_shade.lstrip('#').upper()}" if args.secondary_color == "grey" else ""))
    print(f"Files:     {len(files)} ({'maps only' if args.maps_only else 'all game data'})")
    print("=" * 60)

    if in_place:
        backup.state["in_progress"] = True
        backup.state["languages"] = [args.lang_primary, args.lang_secondary]
        backup.save_state()

    def update(rel, build):
        """Write build(original) over `rel`, or restore the original if it returns None."""
        live = install_dir / rel
        source = backup.source_for(rel) if in_place else pristine_source(install_dir, backup, rel)
        payload = build(source)
        if payload is not None:
            atomic_write(live if in_place else args.output_dir / rel, payload)
            if in_place:
                backup.outputs[rel.as_posix()] = file_stamp(live)
            return True
        written_before = rel.as_posix() in backup.outputs
        if in_place and (written_before or not same_stamp(file_stamp(live), file_stamp(source))):
            # Changed by an earlier run with other settings: put the original back.
            atomic_copy(source, live)
            backup.outputs.pop(rel.as_posix(), None)
        return False

    def merge_file(source):
        nonlocal labels_changed
        data = load_json(source)
        count = merge_labels(data, args.lang_primary, args.lang_secondary,
                             args.separator, args.short_separator, args.secondary_first,
                             FONT_COLORS[args.secondary_color], args.paragraph_separator)
        labels_changed += count
        return dump_json(data) if count else None

    shade = parse_hex_color(args.grey_shade)
    recolor_fonts = args.secondary_color == "grey" and shade != GAME_GREY

    def recolor_font(source):
        return recolor_png(source.read_bytes(), GAME_GREY, shade) if recolor_fonts else None

    files_changed = labels_changed = 0
    errors = []
    for i, rel in enumerate(files, 1):
        print_progress(f"[{i}/{len(files)}] {rel}")
        try:
            files_changed += update(rel, merge_file)
        except (OSError, ValueError) as e:
            errors.append((rel, e))
    for rel in GREY_FONT_IMAGES:
        if not (install_dir / rel).exists():
            continue
        try:
            files_changed += update(rel, recolor_font)
        except (OSError, ValueError, zlib.error) as e:
            errors.append((rel, e))

    if in_place:
        backup.state["in_progress"] = False
        backup.save_state()

    print_progress("")
    print("\r" + "=" * 60)
    print(f"Files scanned:  {len(files)}")
    print(f"Files changed:  {files_changed}")
    print(f"Texts merged:   {labels_changed}")
    if errors:
        print(f"Errors:         {len(errors)}")
    print("=" * 60, flush=True)
    for rel, e in errors:
        print(f"Error in {rel.as_posix()}: {e}", file=sys.stderr)

    if labels_changed == 0:
        print(f"Warning: no text has both {args.lang_primary} and {args.lang_secondary}. "
              "Check the language codes.", file=sys.stderr)
    return 1 if errors or labels_changed == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
