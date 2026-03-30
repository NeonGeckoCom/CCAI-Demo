import unittest
from pydantic import ValidationError
from app.utils.lucide_icons import get_valid_icon_names
from app.config import FeatureConfig, ExampleCategory, PersonaItemConfig


class TestIconRegistry(unittest.TestCase):

    def setUp(self):
        get_valid_icon_names.cache_clear()

    def tearDown(self):
        get_valid_icon_names.cache_clear()

    def test_returns_known_icons(self):
        icons = get_valid_icon_names()
        self.assertGreater(len(icons), 1500)
        self.assertIn("HelpCircle", icons)
        self.assertIn("BookOpen", icons)

    def test_rejects_invalid_icon(self):
        icons = get_valid_icon_names()
        self.assertNotIn("NotARealIcon", icons)


class TestIconValidation(unittest.TestCase):

    def setUp(self):
        get_valid_icon_names.cache_clear()

    def tearDown(self):
        get_valid_icon_names.cache_clear()

    def test_feature_config_accepts_valid_icon(self):
        feature = FeatureConfig(title="Test", description="desc", icon="BookOpen")
        self.assertEqual(feature.icon, "BookOpen")

    def test_example_category_accepts_valid_icon(self):
        example = ExampleCategory(title="Test", icon="Brain")
        self.assertEqual(example.icon, "Brain")

    def test_persona_item_accepts_valid_icon(self):
        persona = PersonaItemConfig(id="test", name="Test", icon="Heart")
        self.assertEqual(persona.icon, "Heart")

    def test_default_icons_are_valid(self):
        feature = FeatureConfig(title="Test", description="desc")
        self.assertEqual(feature.icon, "HelpCircle")

        example = ExampleCategory(title="Test")
        self.assertEqual(example.icon, "BookOpen")

        persona = PersonaItemConfig(id="test", name="Test")
        self.assertEqual(persona.icon, "HelpCircle")

    def test_feature_config_rejects_invalid_icon(self):
        with self.assertRaisesRegex(ValidationError, "Unknown icon"):
            FeatureConfig(title="Test", description="desc", icon="NotARealIcon")

    def test_example_category_rejects_invalid_icon(self):
        with self.assertRaisesRegex(ValidationError, "Unknown icon"):
            ExampleCategory(title="Test", icon="TotallyFake")

    def test_persona_item_rejects_invalid_icon(self):
        with self.assertRaisesRegex(ValidationError, "Unknown icon"):
            PersonaItemConfig(id="test", name="Test", icon="Nope")
