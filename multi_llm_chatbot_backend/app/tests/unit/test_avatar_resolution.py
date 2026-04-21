import unittest
import tempfile
import os
from unittest.mock import patch
from pathlib import Path

from app.config import PersonaItemConfig
from app.utils.avatar_helpers import get_bundled_avatar_path, list_bundled_avatars


class TestAvatarHelpers(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        (self.tmp_path / "advisor1.png").write_bytes(b"fake png")
        (self.tmp_path / "advisor2.svg").write_bytes(b"<svg/>")

    def tearDown(self):
        self._tmp.cleanup()
        list_bundled_avatars.cache_clear()

    @patch("app.utils.avatar_helpers._AVATARS_DIR")
    def test_get_bundled_avatar_path_returns_path_for_existing_file(self, mock_dir):
        mock_dir.__class__ = Path
        with patch("app.utils.avatar_helpers._AVATARS_DIR", self.tmp_path):
            result = get_bundled_avatar_path("advisor1.png")
            self.assertEqual(result, self.tmp_path / "advisor1.png")

    @patch("app.utils.avatar_helpers._AVATARS_DIR")
    def test_get_bundled_avatar_path_returns_none_for_missing_file(self, mock_dir):
        with patch("app.utils.avatar_helpers._AVATARS_DIR", self.tmp_path):
            result = get_bundled_avatar_path("nonexistent.png")
            self.assertIsNone(result)

    def test_get_bundled_avatar_path_returns_none_when_dir_missing(self):
        with patch("app.utils.avatar_helpers._AVATARS_DIR", Path("/nonexistent/dir")):
            result = get_bundled_avatar_path("advisor1.png")
            self.assertIsNone(result)

    def test_list_bundled_avatars_returns_filenames(self):
        with patch("app.utils.avatar_helpers._AVATARS_DIR", self.tmp_path):
            list_bundled_avatars.cache_clear()
            result = list_bundled_avatars()
            self.assertEqual(result, ("advisor1.png", "advisor2.svg"))


class TestResolveImage(unittest.TestCase):

    def test_no_avatar_returns_icon(self):
        persona = PersonaItemConfig(id="test", name="Test", icon="Brain")
        self.assertEqual(
            persona._resolve_image(),
            {"type": "icon", "value": "Brain"},
        )

    def test_external_url_passed_through(self):
        persona = PersonaItemConfig(
            id="test", name="Test", icon="Brain",
            avatar="https://example.com/avatar.png",
        )
        self.assertEqual(
            persona._resolve_image(),
            {"type": "url", "value": "https://example.com/avatar.png"},
        )

    def test_http_url_passed_through(self):
        persona = PersonaItemConfig(
            id="test", name="Test", icon="Brain",
            avatar="http://example.com/avatar.png",
        )
        self.assertEqual(
            persona._resolve_image(),
            {"type": "url", "value": "http://example.com/avatar.png"},
        )

    @patch("app.utils.avatar_helpers.get_bundled_avatar_path")
    def test_bundled_avatar_exists_returns_url(self, mock_get_path):
        mock_get_path.return_value = Path("/fake/path/advisor1.png")
        persona = PersonaItemConfig(
            id="test", name="Test", icon="Brain", avatar="advisor1.png",
        )
        self.assertEqual(
            persona._resolve_image(),
            {"type": "url", "value": "/api/avatars/bundled/advisor1.png"},
        )

    @patch("app.utils.avatar_helpers.get_bundled_avatar_path")
    def test_bundled_avatar_missing_falls_back_to_icon(self, mock_get_path):
        mock_get_path.return_value = None
        persona = PersonaItemConfig(
            id="test", name="Test", icon="Brain", avatar="missing.png",
        )
        self.assertEqual(
            persona._resolve_image(),
            {"type": "icon", "value": "Brain"},
        )

    def test_to_frontend_config_includes_image_field(self):
        persona = PersonaItemConfig(id="test", name="Test", icon="Brain")
        config = persona.to_frontend_config()
        self.assertIn("image", config)
        self.assertNotIn("icon", config)
        self.assertEqual(config["image"], {"type": "icon", "value": "Brain"})
