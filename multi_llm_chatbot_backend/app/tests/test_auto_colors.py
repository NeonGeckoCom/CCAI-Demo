import re
import pytest
from app.config import PersonaItemConfig, generate_persona_colors


HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _perceived_lightness(hex_color: str) -> float:
    """0.0 = black, 1.0 = white. Weighted formula matching human perception."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255


# ---------------------------------------------------------------------------
# generate_persona_colors tests
# ---------------------------------------------------------------------------


def test_all_values_are_valid_hex():
    colors = generate_persona_colors("Methodologist")
    for key in ("color", "bg_color", "dark_color", "dark_bg_color"):
        assert key in colors, f"Missing key: {key}"
        assert HEX_COLOR_RE.match(colors[key]), f"{key}={colors[key]} is not valid hex"


def test_deterministic():
    a = generate_persona_colors("Methodologist")
    b = generate_persona_colors("Methodologist")
    assert a == b


def test_bg_color_is_light_and_dark_bg_is_dark():
    colors = generate_persona_colors("Methodologist")
    assert _perceived_lightness(colors["bg_color"]) > 0.85
    assert _perceived_lightness(colors["dark_bg_color"]) < 0.35


def test_explicit_color_preserved():
    p = PersonaItemConfig(id="test", name="Methodologist", color="#FF0000")
    assert p.color == "#FF0000"