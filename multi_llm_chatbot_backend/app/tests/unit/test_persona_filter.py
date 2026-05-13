import unittest
from app.core.persona_filter import get_available_persona_ids

ALL_IDS = ["pragmatist", "theorist", "methodologist", "mentor", "critic"]


class TestGetAvailablePersonaIds(unittest.TestCase):

    def test_no_filters_returns_all(self):
        """None for both filters means no restrictions."""
        result = get_available_persona_ids(ALL_IDS)
        self.assertEqual(result, ALL_IDS)

    def test_system_whitelist_filters(self):
        result = get_available_persona_ids(
            ALL_IDS, system_allowed=["theorist", "critic"]
        )
        self.assertEqual(result, ["theorist", "critic"])

    def test_user_disabled_filters(self):
        result = get_available_persona_ids(
            ALL_IDS, user_disabled=["mentor", "critic"]
        )
        self.assertEqual(result, ["pragmatist", "theorist", "methodologist"])

    def test_both_layers_cascade(self):
        """System narrows first, then user narrows further."""
        result = get_available_persona_ids(
            ALL_IDS,
            system_allowed=["pragmatist", "theorist", "methodologist"],
            user_disabled=["theorist"],
        )
        self.assertEqual(result, ["pragmatist", "methodologist"])

    def test_unknown_ids_in_user_disabled_ignored(self):
        result = get_available_persona_ids(
            ALL_IDS, user_disabled=["nonexistent", "also_fake"]
        )
        self.assertEqual(result, ALL_IDS)

    def test_all_filtered_returns_empty(self):
        result = get_available_persona_ids(
            ALL_IDS, system_allowed=["theorist"], user_disabled=["theorist"]
        )
        self.assertEqual(result, [])

    def test_order_preserved(self):
        """Result order matches registered_ids, not system_allowed."""
        result = get_available_persona_ids(
            ALL_IDS, system_allowed=["critic", "pragmatist"]
        )
        self.assertEqual(result, ["pragmatist", "critic"])

    def test_system_allowed_empty_list_allows_none(self):
        """An explicit empty whitelist means no advisors are allowed."""
        result = get_available_persona_ids(ALL_IDS, system_allowed=[])
        self.assertEqual(result, [])
