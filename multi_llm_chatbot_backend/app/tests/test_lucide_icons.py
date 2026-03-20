import pytest
from app.utils.lucide_icons import get_valid_icon_names


@pytest.fixture(autouse=True)
def _clear_icon_cache():
    get_valid_icon_names.cache_clear()
    yield
    get_valid_icon_names.cache_clear()


def test_returns_known_icons():
    icons = get_valid_icon_names()
    assert len(icons) > 1500
    assert "HelpCircle" in icons
    assert "BookOpen" in icons


def test_rejects_invalid_icon():
    icons = get_valid_icon_names()
    assert "NotARealIcon" not in icons
