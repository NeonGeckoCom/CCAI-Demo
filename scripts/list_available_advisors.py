#!/usr/bin/env python3
"""Discover all available advisors (static + BrainForge) and print their IDs
for use in the allowed_advisors whitelist.

Usage:
    # Using credentials from .env / phd_config.yaml:
    python3 scripts/list_available_advisors.py

    # Override BrainForge credentials via flags:
    python3 scripts/list_available_advisors.py \
        --api-url https://hana.neonaialpha.com \
        --username admin \
        --password secret

    # Static advisors only (no BrainForge connection needed):
    python3 scripts/list_available_advisors.py --skip-brainforge
"""

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

try:
    import httpx
except ImportError:
    print("Error: httpx is required. Install with: pip install httpx", file=sys.stderr)
    sys.exit(1)

try:
    import yaml
except ImportError:
    yaml = None

CONFIG_PATH = REPO_ROOT / "phd_config.yaml"

BRAINFORGE_PERSONA_PREFIX = "bf"
SKIP_PERSONA_NAMES = {"vanilla"}


def _make_persona_id(model_name: str, persona_name: str) -> str:
    """Mirror the ID generation logic from brainforge_sync.py."""
    short_model = model_name.rsplit("/", 1)[-1].lower()
    safe_name = re.sub(r"[^a-zA-Z0-9]+", "_", persona_name).strip("_")
    return f"{BRAINFORGE_PERSONA_PREFIX}_{short_model}_{safe_name}"


def load_yaml_config() -> dict:
    """Load phd_config.yaml if available."""
    if not CONFIG_PATH.exists():
        return {}
    if yaml is None:
        print("Warning: PyYAML not installed, cannot read config file.", file=sys.stderr)
        return {}
    with open(CONFIG_PATH, "r") as f:
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
        with open(f, "r") as fh:
            data = yaml.safe_load(fh) or {}
        pid = data.get("id", f.stem)
        name = data.get("name", pid)
        results.append((pid, name))

    return results


def get_brainforge_credentials(args, config: dict) -> tuple:
    """Resolve BrainForge credentials from args > env > config."""
    bf_cfg = config.get("llm", {}).get("brainforge", {})

    api_url = (args.api_url or bf_cfg.get("api_url") or "").rstrip("/")
    username = args.username or os.getenv("BRAINFORGE_USERNAME", "") or bf_cfg.get("username", "")
    password = args.password or os.getenv("BRAINFORGE_PASSWORD", "") or bf_cfg.get("password", "")

    return api_url, username, password


def login(api_url: str, username: str, password: str) -> str:
    """Authenticate and return an access token."""
    resp = httpx.post(
        f"{api_url}/auth/login",
        json={
            "username": username,
            "password": password,
            "token_name": "persona-discovery",
            "client_id": "list-brainforge-personas-script",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"Error: Login failed (HTTP {resp.status_code}): {resp.text[:200]}", file=sys.stderr)
        sys.exit(1)

    return resp.json()["access_token"]


def fetch_models(api_url: str, token: str) -> list:
    """Fetch all models from BrainForge."""
    resp = httpx.post(
        f"{api_url}/brainforge/get_models",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"Error: get_models failed (HTTP {resp.status_code}): {resp.text[:200]}", file=sys.stderr)
        sys.exit(1)

    return resp.json().get("models", [])


def get_brainforge_personas(api_url: str, username: str, password: str) -> list:
    """Authenticate and fetch BrainForge persona IDs."""
    print(f"  Connecting to BrainForge at {api_url} ...")
    token = login(api_url, username, password)
    print("  Authenticated successfully.\n")

    models = fetch_models(api_url, token)
    if not models:
        return []

    results = []
    for model in models:
        model_name = model.get("name", "")
        for p in model.get("personas", []):
            persona_name = p.get("persona_name", "")
            if persona_name.lower() in SKIP_PERSONA_NAMES:
                continue
            if not p.get("enabled", True):
                continue
            system_prompt = p.get("system_prompt") or p.get("description") or ""
            if not system_prompt:
                continue
            pid = _make_persona_id(model_name, persona_name)
            results.append((pid, persona_name, model_name))

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List all available persona IDs (static + BrainForge) for the allowed_advisors config."
    )
    parser.add_argument("--api-url", help="BrainForge API URL")
    parser.add_argument("--username", help="BrainForge username")
    parser.add_argument("--password", help="BrainForge password")
    parser.add_argument("--skip-brainforge", action="store_true", help="Only list static personas")
    args = parser.parse_args()

    config = load_yaml_config()

    # --- Static personas ---
    static = get_static_personas(config)
    print(f"Static personas (from persona YAML files): {len(static)} found\n")
    for pid, name in static:
        print(f'    - "{pid}"  # {name}')

    # --- BrainForge personas ---
    bf_personas = []
    if not args.skip_brainforge:
        api_url, username, password = get_brainforge_credentials(args, config)

        if not api_url:
            print("\n  BrainForge: skipped (no API URL configured)")
        elif not username or not password:
            print("\n  BrainForge: skipped (no credentials available)")
        else:
            print()
            bf_personas = get_brainforge_personas(api_url, username, password)
            print(f"  BrainForge personas: {len(bf_personas)} found\n")
            for pid, name, model in bf_personas:
                print(f'    - "{pid}"  # {name} ({model})')
    else:
        print("\n  BrainForge: skipped (--skip-brainforge)")

    # --- Combined YAML output ---
    all_ids = [pid for pid, _ in static] + [pid for pid, _, _ in bf_personas]

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
