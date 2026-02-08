# CrossCultural CrossCode

A Python script to create bilingual map files for the game [CrossCode](http://www.cross-code.com/). This allows you to play the game with dual-language text (e.g., German + English), which is great for language learning or comparison.

## Requirements

*   Python 3.x
*   CrossCode (installed)

## Usage

This script reads map files (`.json`) from the CrossCode installation, combines text from two languages, and outputs new map files. It automatically makes a backup of the original maps folder if you don't provide an output folder.


### Basic Command

Process files with German as the primary language (menus will be in this language) and English as the secondary language:

```bash
python generate-bilingual-crosscode.py \
  --install-dir "/path/to/CrossCode" \
  --lang-primary de_DE \
  --lang-secondary en_US
```

### Advanced Options

*   **`--install-dir`**: Path to the root of your CrossCode installation (the folder containing the `assets` directory). Default is current directory.
*   **`--lang-primary`**: The language key to overwrite (e.g., `de_DE`). You will select this language in the game settings to see the bilingual text.
*   **`--lang-secondary`**: The second language key (e.g., `en_US`) to merge into the primary one.
*   **`--output-dir`**: Custom output folder.
*   **`--separator`**: String that separates the two languages. Default is `\n`.
*   **`--choice-separator`**: String that separates the two languages in player choices. Default is ` / `.
*   **`--secondary-first`**: Make secondary language go *before* the primary language.

### Example: English First

To display English text above German text:

```bash
python generate-bilingual-crosscode.py \
  --install-dir . \
  --lang-primary de_DE \
  --lang-secondary en_US \
  --secondary-first
```

## Known Issues

*   The game only loads fonts for the primary language, so CJK languages (Chinese, Japanese, Korean) only work if the primary language is CJK.
*   Some messages seem to not even be in the map files, so they are not translated. (I can't find them in the source code.)
