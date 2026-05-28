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
