# CrossCultural CrossCode

A Python script that makes the text of [CrossCode](http://www.cross-code.com/) bilingual. You play with two languages at once (for example German + English), which is great for language learning or comparison.

It merges the secondary language into the primary one for all dialogue, choices, quests, items, enemies, tutorials and the DLC. Menus stay in the primary language.

## Requirements

*   Python 3.9 or newer
*   CrossCode (installed)

## Usage

Run the script, then select the **primary** language in the game settings.

```bash
python generate-bilingual-crosscode.py \
  --install-dir "/path/to/CrossCode" \
  --lang-primary de_DE \
  --lang-secondary en_US
```

The secondary language is drawn in grey, so the color alone tells the two apart. Dialogue puts it on its own line, and text that already has paragraphs (notice boards, lore, enemy descriptions) gets a blank line in between. Choices, short labels (names, places, titles) and the current task stay on one line, so they fit their boxes. With `--secondary-color none`, a `~` marks the secondary language instead (`Ja ~ Yes`).

Your save file keeps the current task and recent side messages as they were when they appeared. After a re-run they update once the game shows new ones.

The game files are changed in place. Before anything is changed, the originals are copied to `<install-dir>/bilingual-backup`, and every run starts again from those originals. This means you can:

*   **Re-run with other settings** (another language pair, order or separator) at any time. Nothing is merged twice, and files that no longer need changes are put back.
*   **Undo everything** with `--restore`.
*   **Update the game** safely: changed game files are noticed and the backup is refreshed. Re-run the script after an update.

### Switching languages in-game

Press **F9** while playing to cycle the text between both languages, the primary language only, and the secondary language only. A short notice shows the current mode, and the choice is remembered.

The switch is immediate: the line a character is saying, choices, side messages, notice boards and item names in open menus are redrawn in the new language, and their boxes resize to fit. A line that is still being typed out starts again in the new language. Menu labels (like "Inventar") come from the game's own language files and always stay in the primary language.

This works by loading a small script, `assets/bilingual-toggle.js`, from the game's start page. `--restore` removes it.

Language codes in the game: `en_US`, `de_DE`, `ja_JP`, `ko_KR`, `zh_CN`, `zh_TW`. (`fr_FR` exists only for some texts.)

### Options

*   **`--install-dir`**: The CrossCode folder (the one containing `assets`). Default: current folder.
*   **`--lang-primary`**: The language to overwrite. Select this one in the game.
*   **`--lang-secondary`**: The language to add to it.
*   **`--secondary-first`**: Put the secondary language before the primary one.
*   **`--secondary-color`**: Color of the secondary language: `grey` (default), `yellow`, `orange`, `green`, `red` or `none`. Highlighted words keep their color.
*   **`--grey-shade`**: Shade of the grey, as a hex color. Default: `8C8C8C`, slightly brighter than the game's own `808080`. This recolors the game's grey font images, so the few game texts that use grey get the same shade.
*   **`--separator`**: Separator for dialogue and longer text. Default: a new line, or a blank line for text with paragraphs (`~ ` is added with `--secondary-color none`). A custom separator is used everywhere as given.
*   **`--short-separator`**: Separator for choices, names, places and titles. Default: a space (` ~ ` with `--secondary-color none`). (`--choice-separator` still works.)
*   **`--toggle-key`**: Key for the in-game switch: `F1` to `F6`, `F9` (default) or `F12`; `none` turns the switch off.
*   **`--maps-only`**: Only change map files, like older versions of this script.
*   **`--output-dir`**: Do not touch the game. Write the changed files to this folder instead, using the same folder layout as the install folder (`assets/data/...`).
*   **`--restore`**: Put the original files back and delete the backup.

### Example: English above German

```bash
python generate-bilingual-crosscode.py \
  --install-dir . \
  --lang-primary de_DE \
  --lang-secondary en_US \
  --secondary-first
```

### Upgrading from an older version

Older versions kept their backup in `assets/data/maps_backup`. It is moved to `bilingual-backup` automatically on the first run.

## Known Issues

*   The game only loads fonts for the primary language, so CJK languages (Chinese, Japanese, Korean) only work if the primary language is CJK.
*   Long item or enemy names may not fit in some menus when both languages are shown. Use `--maps-only` if this bothers you.

## Development

Run the tests (no game install needed):

```bash
python -m unittest
```

The in-game switch is tested too when Node.js is installed.
