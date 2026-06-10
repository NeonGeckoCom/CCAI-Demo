import unittest

from app.models.persona import SENTINEL, Persona


class FakeLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


class PersonaResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_response_does_not_retry(self):
        llm = FakeLLM(["### Short answer\nA complete answer.\n" + SENTINEL])
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)

        result = await persona.respond(
            [{"role": "user", "content": "How should I frame this?"}],
            advisor_skill="quick_advice",
        )

        self.assertEqual(len(llm.calls), 1)
        self.assertIn("A complete answer.", result)
        self.assertNotIn(SENTINEL, result)

    async def test_missing_sentinel_retries_with_compact_recovery_prompt(self):
        llm = FakeLLM(
            [
                "### What I notice\nThe first attempt cuts off in",
                (
                    "### What I notice\nThis answer is complete.\n\n"
                    "### Questions to answer\n1. What stance best fits the audience?\n\n"
                    "### Possible interpretation\nYou are calibrating confidence.\n\n"
                    "### Reflection prompt\nName the promise your introduction must keep.\n"
                    + SENTINEL
                ),
            ]
        )
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)

        result = await persona.respond(
            [{"role": "user", "content": "Should my introduction be bold or cautious?"}],
            advisor_skill="socratic_coaching",
        )

        self.assertEqual(len(llm.calls), 2)
        self.assertGreater(llm.calls[1]["max_tokens"], llm.calls[0]["max_tokens"])
        self.assertIn("previous answer did not finish", llm.calls[1]["system_prompt"])
        self.assertIn("This answer is complete.", result)
        self.assertNotIn("cuts off in", result)
        self.assertNotIn(SENTINEL, result)


if __name__ == "__main__":
    unittest.main()
