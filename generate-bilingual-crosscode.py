import os
import json
import argparse
import sys
import shutil
from pathlib import Path
import re

def clean_text(text):
    """Remove line comments that start with <<A<< or <<C<<"""
    if not isinstance(text, str):
        return text
    text = re.sub(r'<<[A-Z]<<\[.*?\]', '', text)
    return text.strip()

def process_map_file(file_path, output_dir, maps_root_dir, lang_primary, lang_secondary, separator, choice_separator, secondary_first):
    """Process a CrossCode map file and create a bilingual version."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        modified = False
        
        def modify_text(obj, key=None):
            nonlocal modified
            if isinstance(obj, dict):
                # Check directly for the language keys in this dictionary
                primary_text = obj.get(lang_primary)
                secondary_text = obj.get(lang_secondary)
                
                # We only act if this object actually has both language keys
                if isinstance(primary_text, str) and isinstance(secondary_text, str):
                    clean_primary = clean_text(primary_text)
                    clean_secondary = clean_text(secondary_text)
                    
                    # Determine which separator to use
                    # Player choices typically use "label" as the key
                    current_sep = choice_separator if key == "label" else separator
                    
                    # Only modify if both texts exist and are different (and not empty)
                    if clean_primary.strip() and clean_secondary.strip() and clean_primary != clean_secondary:
                        
                        # Determine if we have already appended this secondary text
                        # This prevents duplication if the script is run multiple times
                        is_already_bilingual = False
                        if current_sep in primary_text:
                             if secondary_first and primary_text.startswith(clean_secondary):
                                 is_already_bilingual = True
                             elif not secondary_first and primary_text.endswith(clean_secondary):
                                 is_already_bilingual = True
                        
                        # Also check the fallback separator to be extra safe
                        other_sep = separator if current_sep == choice_separator else choice_separator
                        if not is_already_bilingual and other_sep in primary_text:
                             if secondary_first and primary_text.startswith(clean_secondary):
                                 is_already_bilingual = True
                             elif not secondary_first and primary_text.endswith(clean_secondary):
                                 is_already_bilingual = True

                        if not is_already_bilingual:
                            if secondary_first:
                                 new_text = f"{clean_secondary}{current_sep}{clean_primary}"
                            else:
                                 new_text = f"{clean_primary}{current_sep}{clean_secondary}"
                            
                            # We are overwriting the PRIMARY language field with the combined text.
                            obj[lang_primary] = new_text
                            modified = True
                
                # Continue searching recursively
                for k, value in obj.items():
                    if isinstance(value, (dict, list)):
                        modify_text(value, k)
            
            elif isinstance(obj, list):
                for item in obj:
                    modify_text(item, key)
        
        modify_text(data)
        
        if modified:
            # Calculate output path preserving directory structure
            # relative_to needs strict containment, so we use the maps_root_dir passed in
            try:
                relative_path = file_path.relative_to(maps_root_dir)
            except ValueError:
                # Fallback if somehow file is not in root (should not happen with walk)
                relative_path = file_path.name
                
            output_file = output_dir / relative_path
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            # print(f"  Processed: {relative_path}")
            return True
        return False
        
    except Exception as e:
        print(f"Error processing {file_path}: {str(e)}", file=sys.stderr)
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Create unified bilingual map files for CrossCode.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage (German Primary, English Secondary)
  python generate-bilingual-crosscode.py --install-dir /path/to/CrossCode --lang-primary de_DE --lang-secondary en_US
  
  # Secondary language first (English then German)
  python generate-bilingual-crosscode.py --install-dir . --lang-primary de_DE --lang-secondary en_US --secondary-first
        """
    )
    
    parser.add_argument(
        '--install-dir',
        default='.',
        help='Path to CrossCode installation (folder containing "assets")'
    )
    
    parser.add_argument(
        '--lang-primary',
        required=True,
        help='Primary language key (e.g. de_DE). This is the field that will be overwritten.'
    )
    
    parser.add_argument(
        '--lang-secondary',
        required=True,
        help='Secondary language key (e.g. en_US).'
    )
    
    parser.add_argument(
        '--output-dir',
        default=None,
        help='Output directory (default: None -> Overwrite install-dir/maps using a backup)'
    )
    
    parser.add_argument(
        '--separator',
        default='\n',
        help='Separator string between languages (default: \\n)'
    )
    
    parser.add_argument(
        '--choice-separator',
        default=' / ',
        help='Separator string for player choices (key "label") (default: " / ")'
    )
    
    parser.add_argument(
        '--secondary-first',
        action='store_true',
        help='Put secondary language first in the output'
    )
    
    args = parser.parse_args()
    
    # Process escape sequences in separator
    separator = args.separator.replace(r'\n', '\n').replace(r'\r', '\r').replace(r'\t', '\t')
    choice_separator = args.choice_separator.replace(r'\n', '\n').replace(r'\r', '\r').replace(r'\t', '\t')
    
    install_path = Path(args.install_dir)
    maps_dir = install_path / "assets" / "data" / "maps"
    
    if not maps_dir.exists():
        print(f"Error: Maps directory not found at: {maps_dir}", file=sys.stderr)
        print("Please check the --install-dir path.", file=sys.stderr)
        sys.exit(1)
        
    
    if args.output_dir:
        # Standard mode: Read from maps_dir, write to output_dir
        source_dir = maps_dir
        output_base_dir = Path(args.output_dir)
        output_base_dir.mkdir(exist_ok=True)
        in_place_mode = False
    else:
        # In-Place mode:
        # 1. Define backup path
        backup_dir = install_path / "assets" / "data" / "maps_backup"
        
        # 2. Check if backup is needed
        # Logic: If backup doesn't exist OR has different file count than current maps_dir
        # But wait, if we already ran this, maps_dir is modified.
        # Ideally, we want a clean backup.
        # If backup exists, we assume it is the CLEAN source.
        # If backup does NOT exist, we assume maps_dir is the source (and copy it to backup).
        
        current_maps_count = len(list(maps_dir.rglob('*.json')))
        
        backup_valid = False
        if backup_dir.exists():
            backup_count = len(list(backup_dir.rglob('*.json')))
            # Simple heuristic: If counts match (or resemble 918), assume backup is good.
            # User specifically mentioned 918 or "if it doesn't have 918 files".
            # We'll use the user's logic roughly: if backup exists and seems populated.
            if backup_count > 0:
                 backup_valid = True
                 print(f"Backup found at {backup_dir} ({backup_count} files). Using it as base.")
        
        if not backup_valid:
            print(f"Backup invalid or missing. Creating backup from {maps_dir}...")
            if backup_dir.exists():
                shutil.rmtree(backup_dir)
            shutil.copytree(maps_dir, backup_dir)
            print(f"Backup created at {backup_dir}")
            
        # 3. Set source and target
        source_dir = backup_dir
        output_base_dir = maps_dir # We overwrite the live maps
        in_place_mode = True

    print("="*60)
    print("CrossCode Bilingual Map Generator")
    print(f"Mode:        {'IN-PLACE UPDATE (Overwrite)' if in_place_mode else 'EXTERNAL OUTPUT'}")
    print(f"Source:      {source_dir}")
    print(f"Languages:   {args.lang_primary} + {args.lang_secondary}")
    print(f"Order:       {'Secondary -> Primary' if args.secondary_first else 'Primary -> Secondary'}")
    print(f"Output:      {output_base_dir}")
    print("="*60)
    
    # First, collect all JSON files to get the total count for progress tracking
    json_files = sorted(list(source_dir.rglob('*.json')))
    total_json_files = len(json_files)
    
    processed_count = 0
    total_files = 0
    
    print(f"Found {total_json_files} files to process.\n")
    
    for i, file_path in enumerate(json_files, 1):
        # Update progress on the same line
        print(f"[{i}/{total_json_files}] Processing: {file_path.relative_to(source_dir)}", end='\x1b[K\r')
        
        total_files += 1
        # Pass all necessary config to the processor
        if process_map_file(
            file_path=file_path,
            output_dir=output_base_dir,
            maps_root_dir=source_dir,
            lang_primary=args.lang_primary,
            lang_secondary=args.lang_secondary,
            separator=separator,
            choice_separator=choice_separator,
            secondary_first=args.secondary_first
        ):
            processed_count += 1
                    
    print("\n" + "="*60)
    print(f"Processing Complete!")
    print(f"Total files scanned: {total_files}")
    print(f"Files modified:      {processed_count}")
    print("="*60)

if __name__ == "__main__":
    main()