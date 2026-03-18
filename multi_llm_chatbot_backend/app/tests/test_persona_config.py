import pytest
import os, yaml
import app.config
from app.config import load_settings, load_personas_from_dir, PersonasConfig


@pytest.fixture(autouse=True)
def _reset_settings_singleton():
    app.config._settings = None
    yield
    app.config._settings = None


def _write_config(tmp_path, data: dict) -> str:
    path = os.path.join(str(tmp_path), "config.yaml")
    with open(path, "w") as f:
        yaml.dump(data, f)
    return path


def _write_persona(directory, filename, data: dict):
    path = os.path.join(str(directory), filename)
    with open(path, "w") as f:
        yaml.dump(data, f)


# ---------------------------------------------------------------------------
# load_settings tests
# ---------------------------------------------------------------------------

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


def test_load_settings_uses_personas_dir(tmp_path):
    """Test that load_settings loads personas from a directory when personas_dir is set."""
    # Create a personas subdirectory inside the temp dir
    personas_dir = os.path.join(str(tmp_path), "personas")
    os.makedirs(personas_dir)

    # Write two persona files into it
    _write_persona(personas_dir, "one.yaml", {"id": "one", "name": "One"})
    _write_persona(personas_dir, "two.yaml", {"id": "two", "name": "Two"})

    # Write a main config that points to the directory
    cfg_path = _write_config(tmp_path, {
        "personas": {
            "base_prompt": "Be helpful.",
            "personas_dir": "personas",
        }
    })

    settings = load_settings(cfg_path)
    assert len(settings.personas.items) == 2
    ids = {p.id for p in settings.personas.items}
    assert ids == {"one", "two"}


def test_bad_persona_does_not_crash_everything(tmp_path):
    """Validates that a bad persona in the inline items list causes a
    validation error — the directory loader solves this for file-based configs."""
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


# ---------------------------------------------------------------------------
# load_personas_from_dir tests
# ---------------------------------------------------------------------------

def test_loads_personas_from_directory(tmp_path):
    _write_persona(tmp_path, "one.yaml", {"id": "one", "name": "One"})
    _write_persona(tmp_path, "two.yaml", {"id": "two", "name": "Two"})
    result = load_personas_from_dir(str(tmp_path))
    assert len(result) == 2
    ids = {p.id for p in result}
    assert ids == {"one", "two"}


def test_personas_config_validator_loads_from_dir(tmp_path):
    """Test that PersonasConfig's model_validator loads personas automatically."""
    _write_persona(tmp_path, "one.yaml", {"id": "one", "name": "One"})
    _write_persona(tmp_path, "two.yaml", {"id": "two", "name": "Two"})

    config = PersonasConfig(personas_dir=str(tmp_path))
    assert len(config.items) == 2
    ids = {p.id for p in config.items}
    assert ids == {"one", "two"}


def test_skips_invalid_persona_files(tmp_path):
    _write_persona(tmp_path, "good.yaml", {"id": "good", "name": "Good"})
    _write_persona(tmp_path, "bad.yaml", {"not_id": "bad"})
    result = load_personas_from_dir(str(tmp_path))
    assert len(result) == 1
    assert result[0].id == "good"


def test_disabled_persona_excluded(tmp_path):
    _write_persona(tmp_path, "on.yaml", {"id": "on", "name": "On"})
    _write_persona(tmp_path, "off.yaml", {"id": "off", "name": "Off", "enabled": False})
    result = load_personas_from_dir(str(tmp_path))
    assert len(result) == 1
    assert result[0].id == "on"


def test_duplicate_id_rejected(tmp_path):
    _write_persona(tmp_path, "a.yaml", {"id": "same", "name": "First"})
    _write_persona(tmp_path, "b.yaml", {"id": "same", "name": "Second"})
    result = load_personas_from_dir(str(tmp_path))
    assert len(result) == 1
    assert result[0].name == "First"


def test_duplicate_name_rejected(tmp_path):
    _write_persona(tmp_path, "a.yaml", {"id": "id_a", "name": "Same Name"})
    _write_persona(tmp_path, "b.yaml", {"id": "id_b", "name": "Same Name"})
    result = load_personas_from_dir(str(tmp_path))
    assert len(result) == 1
    assert result[0].id == "id_a"


def test_missing_directory_returns_empty(tmp_path):
    result = load_personas_from_dir(os.path.join(str(tmp_path), "nonexistent"))
    assert result == []

