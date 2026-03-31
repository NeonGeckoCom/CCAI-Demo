import unittest
import os
import tempfile
import yaml
import app.config
from app.config import load_settings, load_personas_from_dir, PersonasConfig


def _write_config(tmp_path, data: dict) -> str:
    path = os.path.join(tmp_path, "config.yaml")
    with open(path, "w") as f:
        yaml.dump(data, f)
    return path


def _write_persona(directory, filename, data: dict):
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(data, f)


class TestLoadSettings(unittest.TestCase):

    def setUp(self):
        app.config._settings = None
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = self._tmp.name

    def tearDown(self):
        app.config._settings = None
        self._tmp.cleanup()

    def test_loads_personas_from_main_config(self):
        cfg_path = _write_config(self.tmp_path, {
            "personas": {
                "base_prompt": "Be helpful.",
                "items": [
                    {"id": "test1", "name": "Test One", "persona_prompt": "You are test1."},
                ]
            }
        })
        settings = load_settings(cfg_path)
        self.assertEqual(len(settings.personas.items), 1)
        self.assertEqual(settings.personas.items[0].id, "test1")

    def test_uses_personas_dir(self):
        """Test that load_settings loads personas from a directory when personas_dir is set."""
        personas_dir = os.path.join(self.tmp_path, "personas")
        os.makedirs(personas_dir)

        _write_persona(personas_dir, "one.yaml", {"id": "one", "name": "One"})
        _write_persona(personas_dir, "two.yaml", {"id": "two", "name": "Two"})

        cfg_path = _write_config(self.tmp_path, {
            "personas": {
                "base_prompt": "Be helpful.",
                "personas_dir": "personas",
            }
        })

        settings = load_settings(cfg_path)
        self.assertEqual(len(settings.personas.items), 2)
        ids = {p.id for p in settings.personas.items}
        self.assertEqual(ids, {"one", "two"})

    def test_bad_persona_does_not_crash_everything(self):
        """Validates that a bad persona in the inline items list causes a
        validation error -- the directory loader solves this for file-based configs."""
        cfg_path = _write_config(self.tmp_path, {
            "personas": {
                "items": [
                    {"id": "good", "name": "Good"},
                    {"not_an_id": "bad"},
                ]
            }
        })
        with self.assertRaises(Exception):
            load_settings(cfg_path)


class TestLoadPersonasFromDir(unittest.TestCase):

    def setUp(self):
        app.config._settings = None
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = self._tmp.name

    def tearDown(self):
        app.config._settings = None
        self._tmp.cleanup()

    def test_loads_personas_from_directory(self):
        _write_persona(self.tmp_path, "one.yaml", {"id": "one", "name": "One"})
        _write_persona(self.tmp_path, "two.yaml", {"id": "two", "name": "Two"})
        result = load_personas_from_dir(self.tmp_path)
        self.assertEqual(len(result), 2)
        ids = {p.id for p in result}
        self.assertEqual(ids, {"one", "two"})

    def test_personas_config_validator_loads_from_dir(self):
        """Test that PersonasConfig's model_validator loads personas automatically."""
        _write_persona(self.tmp_path, "one.yaml", {"id": "one", "name": "One"})
        _write_persona(self.tmp_path, "two.yaml", {"id": "two", "name": "Two"})

        config = PersonasConfig(personas_dir=self.tmp_path)
        self.assertEqual(len(config.items), 2)
        ids = {p.id for p in config.items}
        self.assertEqual(ids, {"one", "two"})

    def test_skips_invalid_persona_files(self):
        _write_persona(self.tmp_path, "good.yaml", {"id": "good", "name": "Good"})
        _write_persona(self.tmp_path, "bad.yaml", {"not_id": "bad"})
        result = load_personas_from_dir(self.tmp_path)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "good")

    def test_disabled_persona_excluded(self):
        _write_persona(self.tmp_path, "on.yaml", {"id": "on", "name": "On"})
        _write_persona(self.tmp_path, "off.yaml", {"id": "off", "name": "Off", "enabled": False})
        result = load_personas_from_dir(self.tmp_path)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "on")

    def test_duplicate_id_rejected(self):
        _write_persona(self.tmp_path, "a.yaml", {"id": "same", "name": "First"})
        _write_persona(self.tmp_path, "b.yaml", {"id": "same", "name": "Second"})
        result = load_personas_from_dir(self.tmp_path)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "First")

    def test_duplicate_name_rejected(self):
        _write_persona(self.tmp_path, "a.yaml", {"id": "id_a", "name": "Same Name"})
        _write_persona(self.tmp_path, "b.yaml", {"id": "id_b", "name": "Same Name"})
        result = load_personas_from_dir(self.tmp_path)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "id_a")

    def test_missing_directory_returns_empty(self):
        result = load_personas_from_dir(os.path.join(self.tmp_path, "nonexistent"))
        self.assertEqual(result, [])
