"""
Tool registry — auto-discovers tool modules in app.tools and provides
a central API for retrieving definitions and dispatching calls.

Every tool module in this package must export:
    TOOL_DEFINITION : Dict[str, Any]   — OpenAI tool format
                                         {"type": "function", "function": {"name": ..., ...}}
    execute         : async (**kwargs)  — returns Dict[str, Any]

Modules that don't export both are silently skipped.

Filtering semantics for the ``enabled`` parameter:
    None  — no filter; all registered tools are available (default)
    []    — explicit empty list; no tools are available
    [ids] — only the named tools are available
"""

import importlib
import inspect
import logging
import pkgutil
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# Shared User-Agent for HTTP clients in tool modules (FOSE, RMP, etc.).
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

_REGISTRY: Dict[str, Dict[str, Any]] = {}


def _discover_tools() -> None:
    """Scan sibling modules in app.tools and register any that export
    TOOL_DEFINITION and execute."""
    import app.tools as tools_pkg

    for _finder, module_name, _is_pkg in pkgutil.iter_modules(tools_pkg.__path__):
        qualified = f"app.tools.{module_name}"
        try:
            mod = importlib.import_module(qualified)
        except Exception:
            logger.warning("Failed to import tool module: %s", qualified, exc_info=True)
            continue

        defn = getattr(mod, "TOOL_DEFINITION", None)
        executor = getattr(mod, "execute", None)

        if defn is None or executor is None:
            continue

        if (not isinstance(defn, dict)
                or defn.get("type") != "function"
                or not isinstance(defn.get("function"), dict)
                or "name" not in defn["function"]):
            logger.warning("Skipping %s: TOOL_DEFINITION not in OpenAI tool format", qualified)
            continue

        if not callable(executor) or not inspect.iscoroutinefunction(executor):
            logger.warning("Skipping %s: execute is not an async callable", qualified)
            continue

        tool_name = defn["function"]["name"]
        if tool_name in _REGISTRY:
            logger.warning(
                "Duplicate tool name '%s' from %s — skipping", tool_name, qualified,
            )
            continue

        _REGISTRY[tool_name] = {"definition": defn, "executor": executor}
        logger.info("Registered tool: %s (from %s)", tool_name, qualified)


def get_tool_definitions(enabled: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Return OpenAI-format tool dicts for registered tools.

    If *enabled* is provided, only return tools whose names are in that list.
    If None, return all registered tools.
    """
    if enabled is None:
        return [entry["definition"] for entry in _REGISTRY.values()]

    return [
        _REGISTRY[name]["definition"]
        for name in enabled
        if name in _REGISTRY
    ]


def get_tool_executor(enabled: Optional[List[str]] = None) -> Callable:
    """Return a dispatcher compatible with generate_with_tools(tool_executor=...).

    The returned async callable accepts (name, **kwargs) and routes to the
    correct tool executor.  If *enabled* is provided, only those tools are
    dispatchable.
    """
    if enabled is not None:
        allowed = {name for name in enabled if name in _REGISTRY}
    else:
        allowed = None

    async def dispatch(name: str, **kwargs: Any) -> Dict[str, Any]:
        if allowed is not None and name not in allowed:
            logger.warning("Tool '%s' is not enabled", name)
            return {"error": f"Tool not enabled: {name}"}

        entry = _REGISTRY.get(name)
        if entry is None:
            logger.warning("Unknown tool requested: %s", name)
            return {"error": f"Unknown tool: {name}"}

        return await entry["executor"](name=name, **kwargs)

    return dispatch


def list_registered_tools() -> List[str]:
    """Return the names of all discovered tools."""
    return list(_REGISTRY.keys())


_discover_tools()
