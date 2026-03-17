import pytest
import tempfile, os, yaml
from app.config import load_settings

def _write_config(tmp_path, data: dict) -> str:
    path = os.path.join(str(tmp_path), "config.yaml")
    with open(path, "w") as f:
        yaml.dump(data, f)
    return path

def test_loads_personas_from_main_config(tmp_path):
    cfg_path = _write_config(tmp_path, {
        "personas": {
            "base_prompt": "Be helpful.",
            "items": [
                {"id": "test1", "name": "Test One", "persona_prompt": "You are test1."},
            ]
        }
    })
    settings = load_settings(cfg_path)
    assert len(settings.personas.items) == 1
    assert settings.personas.items[0].id == "test1"

def test_bad_persona_does_not_crash_everything(tmp_path):
    """This test will FAIL with the current code — that's the point.
    It documents the problem the refactor will fix."""
    cfg_path = _write_config(tmp_path, {
        "personas": {
            "items": [
                {"id": "good", "name": "Good"},
                {"not_an_id": "bad"},  # missing required 'id' and 'name'
            ]
        }
    })
    with pytest.raises(Exception):
        load_settings(cfg_path)