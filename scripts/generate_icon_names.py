#!/usr/bin/env python3
"""Fetch valid Lucide icon names and write them to a static JSON file.

Run this whenever the lucide-react version is bumped in
phd-advisor-frontend/package.json:

    python3 scripts/generate_icon_names.py
"""

import json
import re
import sys
from pathlib import Path
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = REPO_ROOT / "phd-advisor-frontend" / "package.json"
OUTPUT_FILE = (
    REPO_ROOT
    / "multi_llm_chatbot_backend"
    / "app"
    / "utils"
    / "_lucide_icon_names.json"
)


def _kebab_to_pascal(name: str) -> str:
    return "".join(
        seg.capitalize() if seg.isalpha() else seg for seg in name.split("-")
    )


def main() -> int:
    package_data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = package_data["dependencies"]["lucide-react"].lstrip("^~")

    url = (
        f"https://unpkg.com/lucide-react@{version}"
        "/dist/esm/dynamicIconImports.js"
    )
    print(f"Fetching {url} ...")
    with urlopen(url, timeout=15) as resp:  # noqa: S310
        js_source = resp.read().decode("utf-8")

    kebab_names = re.findall(r'"([a-z0-9][a-z0-9-]*)"(?=\s*:)', js_source)
    pascal_names = sorted(set(_kebab_to_pascal(n) for n in kebab_names))

    OUTPUT_FILE.write_text(
        json.dumps({"version": version, "icons": pascal_names}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(pascal_names)} icon names (v{version}) to {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
