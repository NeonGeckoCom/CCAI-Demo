from typing import List, Optional


def get_available_persona_ids(
    registered_ids: List[str],
    system_allowed: Optional[List[str]] = None,
    user_disabled: Optional[List[str]] = None,
) -> List[str]:
    """Return the persona IDs available after applying all filtering layers.

    Filtering is applied in order:
      1. System whitelist (``system_allowed``) — if not None, only IDs
         present in this list survive.  ``None`` means no restriction.
      2. User blocklist (``user_disabled``) — if not None, these IDs are
         removed.  ``None`` means no user overrides.

    The order of *registered_ids* is preserved in the result so that
    downstream fallback logic (e.g. first-K when LLM ranking fails)
    remains deterministic.
    """
    ids = list(registered_ids)

    if system_allowed is not None:
        ids = [pid for pid in ids if pid in system_allowed]

    if user_disabled is not None:
        ids = [pid for pid in ids if pid not in user_disabled]

    return ids


def select_persona_ids(
    available_ids: List[str],
    requested_ids: Optional[List[str]] = None,
    max_personas: int = 3,
) -> List[str]:
    """Select the requested, available personas in the user's order.

    A request with no usable IDs keeps the historical single-advisor fallback.
    If IDs were explicitly requested but none are available, an empty list is
    returned so the caller can report that selection error. Duplicate IDs are
    ignored and the result is capped to bound concurrent LLM calls.
    """
    requested = [persona_id for persona_id in (requested_ids or []) if persona_id]
    if not requested:
        return available_ids[:1]

    available = set(available_ids)
    selected = []
    for persona_id in requested:
        if persona_id in available and persona_id not in selected:
            selected.append(persona_id)
            if len(selected) >= max_personas:
                break

    return selected
