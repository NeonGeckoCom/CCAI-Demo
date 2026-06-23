#!/usr/bin/env python3
"""List configured static advisor IDs for use in the allowed_advisors whitelist.

Usage:
    python3 scripts/list_available_advisors.py
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

try:
    import yaml
except ImportError:
    yaml = None

CONFIG_PATH = REPO_ROOT / "phd_config.yaml"


def load_yaml_config() -> dict:
    """Load phd_config.yaml if available."""
    if not CONFIG_PATH.exists():
        return {}
    if yaml is None:
        print("Warning: PyYAML not installed, cannot read config file.", file=sys.stderr)
        return {}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def get_static_personas(config: dict) -> list:
    """Load static persona IDs/names from the personas directory."""
    personas_cfg = config.get("personas", {})
    personas_dir = personas_cfg.get("personas_dir", "")

    if not personas_dir:
        return []

    dir_path = Path(personas_dir)
    if not dir_path.is_absolute():
        dir_path = CONFIG_PATH.parent / dir_path

    if not dir_path.is_dir():
        return []

    results = []
    for f in sorted(dir_path.glob("*.yaml")):
        if yaml is None:
            pid = f.stem
            results.append((pid, pid))
            continue
        with open(f, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        pid = data.get("id", f.stem)
        name = data.get("name", pid)
        results.append((pid, name))

    return results


def main() -> int:
    config = load_yaml_config()

    static = get_static_personas(config)
    print(f"Static personas (from persona YAML files): {len(static)} found\n")
    for pid, name in static:
        print(f'    - "{pid}"  # {name}')

    all_ids = [pid for pid, _ in static]

    if not all_ids:
        print("\nNo personas found.")
        return 0

    print("\n" + "=" * 60)
    print("YAML-ready allowed_advisors (copy into phd_config.yaml):")
    print("=" * 60 + "\n")
    print("  allowed_advisors:")
    for pid in all_ids:
        print(f'    - "{pid}"')

    return 0


if __name__ == "__main__":
    sys.exit(main())
