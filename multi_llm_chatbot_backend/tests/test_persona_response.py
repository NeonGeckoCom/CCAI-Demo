import unittest

from app.llm.clients.llm_client import LLMStreamChunk
from app.models.persona import SENTINEL, Persona


class FakeLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


class FakeStreamingLLM:
    def __init__(self, chunks, responses=None):
        self.chunks = list(chunks)
        self.calls = []
        self.responses = list(responses or [])
        self.generate_calls = []

    async def stream_generate(self, **kwargs):
        self.calls.append(kwargs)
        for chunk in self.chunks:
            yield chunk

    async def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
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

    async def test_response_is_not_wrapped_in_forced_skill_heading(self):
        llm = FakeLLM(["This is the clearest answer for the student's situation.\n" + SENTINEL])
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)

        result = await persona.respond(
            [{"role": "user", "content": "Is this argument strong enough?"}],
            advisor_skill="deep_review",
        )

        self.assertEqual(result, "This is the clearest answer for the student's situation.")
        self.assertNotIn("###", result)

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

    async def test_streaming_response_filters_split_sentinel_and_thoughts(self):
        llm = FakeStreamingLLM(
            [
                LLMStreamChunk("Private plan", kind="thought"),
                LLMStreamChunk("### Short answer\nStart", kind="text"),
                LLMStreamChunk(" and finish</", kind="text"),
                LLMStreamChunk("END> ignored", kind="text"),
            ]
        )
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)
        streamed = []

        async def on_chunk(chunk):
            streamed.append((chunk.kind, chunk.text))

        result = await persona.respond_stream(
            [{"role": "user", "content": "How should I frame this?"}],
            advisor_skill="quick_advice",
            on_chunk=on_chunk,
        )

        streamed_text = "".join(text for kind, text in streamed if kind == "text")
        streamed_thoughts = "".join(text for kind, text in streamed if kind == "thought")

        self.assertEqual(llm.calls[0]["max_tokens"], None)
        self.assertTrue(llm.calls[0]["include_thoughts"])
        self.assertEqual(streamed_thoughts, "Private plan")
        self.assertIn("Start and finish", streamed_text)
        self.assertNotIn(SENTINEL, streamed_text)
        self.assertNotIn("ignored", streamed_text)
        self.assertIn("Start and finish", result)
        self.assertNotIn(SENTINEL, result)
        self.assertNotIn("ignored", result)

    async def test_streaming_response_does_not_apply_app_length_cap(self):
        long_body = " ".join(f"word{i}" for i in range(950))
        llm = FakeStreamingLLM(
            [LLMStreamChunk(f"### Short answer\n{long_body}{SENTINEL}", kind="text")]
        )
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)

        result = await persona.respond_stream(
            [{"role": "user", "content": "Please be thorough."}],
            advisor_skill="quick_advice",
        )

        self.assertIn("word949", result)
        self.assertNotIn(SENTINEL, result)

    async def test_streaming_missing_sentinel_retries_before_final_response(self):
        llm = FakeStreamingLLM(
            [LLMStreamChunk("### Short answer\nThis cuts off at (Pa", kind="text")],
            responses=["### Short answer\nThis answer is complete.\n" + SENTINEL],
        )
        persona = Persona("critic", "Constructive Critic", "System prompt", llm)
        streamed = []

        async def on_chunk(chunk):
            streamed.append(chunk.text)

        result = await persona.respond_stream(
            [{"role": "user", "content": "Which parts involve no interaction?"}],
            advisor_skill="document_feedback",
            on_chunk=on_chunk,
        )

        self.assertEqual(len(llm.generate_calls), 1)
        self.assertGreater(llm.generate_calls[0]["max_tokens"], 1200)
        self.assertIn("previous answer did not finish", llm.generate_calls[0]["system_prompt"])
        self.assertIn("This cuts off at (Pa", "".join(streamed))
        self.assertIn("This answer is complete.", result)
        self.assertNotIn("cuts off", result)
        self.assertNotIn(SENTINEL, result)


if __name__ == "__main__":
    unittest.main()
