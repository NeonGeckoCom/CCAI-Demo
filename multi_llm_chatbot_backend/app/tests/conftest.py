import pytest
import app.config as config_module

@pytest.fixture(autouse=True)
def reset_config_singleton():
    """Clear the cached settings so each test gets a fresh load."""
    config_module._settings = None
    yield
    config_module._settings = None

