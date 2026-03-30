import pytest
from pydantic import ValidationError
from app.utils.lucide_icons import get_valid_icon_names
from app.config import FeatureConfig, ExampleCategory, PersonaItemConfig


@pytest.fixture(autouse=True)
def _clear_icon_cache():
    get_valid_icon_names.cache_clear()
    yield
    get_valid_icon_names.cache_clear()


# ---------------------------------------------------------------------------
# Icon registry tests
# ---------------------------------------------------------------------------


def test_returns_known_icons():
    icons = get_valid_icon_names()
    assert len(icons) > 1500
    assert "HelpCircle" in icons
    assert "BookOpen" in icons


def test_rejects_invalid_icon():
    icons = get_valid_icon_names()
    assert "NotARealIcon" not in icons


# ---------------------------------------------------------------------------
# Icon validation tests
# ---------------------------------------------------------------------------


def test_feature_config_accepts_valid_icon():
    feature = FeatureConfig(title="Test", description="desc", icon="BookOpen")
    assert feature.icon == "BookOpen"


def test_example_category_accepts_valid_icon():
    example = ExampleCategory(title="Test", icon="Brain")
    assert example.icon == "Brain"


def test_persona_item_accepts_valid_icon():
    persona = PersonaItemConfig(id="test", name="Test", icon="Heart")
    assert persona.icon == "Heart"


def test_default_icons_are_valid():
    feature = FeatureConfig(title="Test", description="desc")
    assert feature.icon == "HelpCircle"

    example = ExampleCategory(title="Test")
    assert example.icon == "BookOpen"

    persona = PersonaItemConfig(id="test", name="Test")
    assert persona.icon == "HelpCircle"


def test_feature_config_rejects_invalid_icon():
    with pytest.raises(ValidationError, match="Unknown icon"):
        FeatureConfig(title="Test", description="desc", icon="NotARealIcon")


def test_example_category_rejects_invalid_icon():
    with pytest.raises(ValidationError, match="Unknown icon"):
        ExampleCategory(title="Test", icon="TotallyFake")


def test_persona_item_rejects_invalid_icon():
    with pytest.raises(ValidationError, match="Unknown icon"):
        PersonaItemConfig(id="test", name="Test", icon="Nope")
