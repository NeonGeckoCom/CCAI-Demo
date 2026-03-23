#!/usr/bin/env python3
"""Fetch valid Lucide icon names by introspecting the installed lucide-react package.

Requires node_modules to be installed in phd-advisor-frontend/:

    cd phd-advisor-frontend && npm install
    python3 scripts/generate_icon_names.py
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = REPO_ROOT / "phd-advisor-frontend" / "package.json"
FRONTEND_DIR = REPO_ROOT / "phd-advisor-frontend"
OUTPUT_FILE = (
    REPO_ROOT
    / "multi_llm_chatbot_backend"
    / "app"
    / "utils"
    / "_lucide_icon_names.json"
)

JS_SNIPPET = """\
const icons = require('lucide-react');
const names = Object.keys(icons).filter(k => /^[A-Z]/.test(k) && !k.endsWith('Icon') && !k.startsWith('Lucide')).sort();
console.log(JSON.stringify(names));
"""


def main() -> int:
    package_data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = package_data["dependencies"]["lucide-react"].lstrip("^~")

    node_modules = FRONTEND_DIR / "node_modules" / "lucide-react"
    if not node_modules.exists():
        print(
            f"Error: lucide-react not found at {node_modules}\n"
            f"Run 'cd phd-advisor-frontend && npm install' first.",
            file=sys.stderr,
        )
        return 1

    print(f"Introspecting lucide-react@{version} exports via Node ...")
    result = subprocess.run(
        ["node", "-e", JS_SNIPPET],
        cwd=str(FRONTEND_DIR),
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"Node failed:\n{result.stderr}", file=sys.stderr)
        return 1

    pascal_names = json.loads(result.stdout)

    OUTPUT_FILE.write_text(
        json.dumps({"version": version, "icons": pascal_names}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(pascal_names)} icon names (v{version}) to {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
