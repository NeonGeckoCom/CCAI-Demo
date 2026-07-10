import json
import os
import unittest

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from fastapi import HTTPException

from app.api.routes import defense as defense_route
from app.api.routes.defense import (
    AcademicProfile,
    AcademicProfileSource,
    CommitteeMemberRequest,
    DefenseMaterial,
    DefenseQuestionsRequest,
    PublicProfileResource,
    _candidate_question_count,
    _normalize_llm_questions,
    _best_openalex_author,
    _question_evidence_text,
    llm_profile_questions,
    parse_defense_material,
    resolve_committee_profile,
)
from app.models.user import User


class FakeUpload:
    def __init__(self, filename, content, content_type="text/plain"):
        self.filename = filename
        self._content = content
        self.content_type = content_type

    async def read(self):
        return self._content


class FakeQuestionLLM:
    def __init__(self):
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return json.dumps(
            {
                "questions": [
                    {
                        "tag": "Pitch",
                        "q": "What is the main robotic manipulation claim?",
                        "member_id": "real-1",
                        "member_name": "Poster Expert",
                        "grounded_in": ["robotic manipulation"],
                    }
                ]
            }
        )


class FakeHallucinatingQuestionLLM:
    async def generate(self, **kwargs):
        return json.dumps(
            {
                "questions": [
                    {
                        "tag": "Methods",
                        "q": (
                            "Given real-time robot control, how did you validate "
                            "computational latency in human-robot proximity sensors?"
                        ),
                        "member_id": "real-1",
                        "member_name": "Committee Member",
                        "grounded_in": ["unsupported proximity sensor premise"],
                    }
                ]
            }
        )


class FakeEmptyQuestionLLM:
    async def generate(self, **kwargs):
        return ""


class FakePlainTextQuestionLLM:
    async def generate(self, **kwargs):
        return "I apologize, but I'm unable to generate a response right now. Please try again."


class FakeRetryQuestionLLM:
    def __init__(self):
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            return "The AI service is taking too long to respond. Please try again."
        return json.dumps(
            {
                "questions": [
                    {
                        "tag": "Methods",
                        "q": "What robotic manipulation evidence supports the policy evaluation?",
                        "member_id": "real-1",
                        "member_name": "Committee Member",
                        "grounded_in": ["robotic manipulation policy evaluation"],
                    },
                    {
                        "tag": "Evidence",
                        "q": "How would you validate the robotic manipulation results?",
                        "member_id": "real-1",
                        "member_name": "Committee Member",
                        "grounded_in": ["robotic manipulation results"],
                    },
                ]
            }
        )


class FakeMixedPanelQuestionLLM:
    def __init__(self):
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return json.dumps(
            {
                "questions": [
                    {
                        "tag": "Methods",
                        "q": "What validity threat would most weaken the robotic manipulation evidence?",
                        "member_id": "methodologist",
                        "member_name": "Methodologist",
                        "grounded_in": ["validity threats"],
                    },
                    {
                        "tag": "Theory",
                        "q": "Which theoretical construct does the manipulation policy claim depend on?",
                        "member_id": "theorist",
                        "member_name": "Theorist",
                        "grounded_in": ["conceptual framing"],
                    },
                ]
            }
        )


class DefenseProfileTests(unittest.IsolatedAsyncioTestCase):

    async def test_supplied_profile_skips_runtime_search(self):
        def unexpected_searcher(member):
            raise AssertionError("search should not run when profile is supplied")

        profile = await resolve_committee_profile(
            CommitteeMemberRequest(
                id="real-3",
                name="Resolved Member",
                profile=AcademicProfile(
                    id="from-add",
                    name="Resolved Member",
                    source_status="web",
                    confidence=0.8,
                    research_areas=["robotic manipulation"],
                ),
            ),
            searcher=unexpected_searcher,
            llm_client=False,
        )

        self.assertEqual(profile.id, "real-3")
        self.assertEqual(profile.source_status, "web")
        self.assertEqual(profile.research_areas, ["robotic manipulation"])

    async def test_runtime_search_resources_are_used_for_public_profile(self):
        calls = []

        def fake_searcher(member):
            calls.append(member.name)
            return [
                PublicProfileResource(
                    title="Nikolaus Correll | Public Lab Profile",
                    url="https://example.edu/correll",
                    kind="profile",
                    text=(
                        "Nikolaus Correll is a professor of computer science. "
                        "His research includes robotic materials, robotic manipulation, "
                        "swarm robotics, and autonomous robots. Publications: "
                        "A versatile robotic hand with 3D perception and force sensing "
                        "for autonomous manipulation. Talks: IROS keynote on robotics."
                    ),
                )
            ]

        profile = await resolve_committee_profile(
            CommitteeMemberRequest(
                id="real-1",
                name="Nikolaus Correll",
                institution="University of Colorado Boulder",
            ),
            searcher=fake_searcher,
            llm_client=False,
        )

        self.assertEqual(calls, ["Nikolaus Correll"])
        self.assertEqual(profile.id, "real-1")
        self.assertEqual(profile.source_status, "web")
        self.assertIn("robotic materials", profile.research_areas)
        self.assertIn("robotic manipulation", profile.research_areas)
        self.assertTrue(
            any("robotic hand" in work.title.lower() for work in profile.publications)
        )
        self.assertEqual(profile.sources[0].url, "https://example.edu/correll")

    async def test_openalex_author_ranking_uses_supplied_affiliation(self):
        member = CommitteeMemberRequest(
            name="Alex Example",
            institution="Colorado Boulder",
        )
        authors = [
            {
                "display_name": "Alex Example",
                "works_count": 200,
                "cited_by_count": 1000,
                "affiliations": [
                    {"institution": {"display_name": "Example Institute"}}
                ],
            },
            {
                "display_name": "Alex Example",
                "works_count": 10,
                "cited_by_count": 20,
                "affiliations": [
                    {"institution": {"display_name": "University of Colorado Boulder"}}
                ],
            },
        ]

        best = _best_openalex_author(member, authors)

        self.assertEqual(
            best["affiliations"][0]["institution"]["display_name"],
            "University of Colorado Boulder",
        )

    async def test_unknown_member_uses_supplied_area_but_questions_require_web_profile(self):
        profile = await resolve_committee_profile(
            CommitteeMemberRequest(
                id="real-2",
                name="Dr. Example",
                title="Assoc. Prof., HCI",
                area="human-computer interaction",
            ),
            searcher=lambda member: [],
            llm_client=False,
        )

        self.assertEqual(profile.source_status, "user_supplied")

        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        with self.assertRaises(HTTPException) as raised:
            await defense_route.defense_questions(
                DefenseQuestionsRequest(
                    format="defense",
                    committee_members=[
                        CommitteeMemberRequest(name="Dr. Example", profile=profile)
                    ],
                    question_count=1,
                    use_llm=True,
                ),
                current_user=user,
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["reason"], "public_profile_required")

    async def test_defense_material_parser_extracts_uploaded_text(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )

        result = await parse_defense_material(
            FakeUpload(
                "defense-notes.txt",
                b"My central claim is that sparse demonstrations can support robust manipulation.",
            ),
            current_user=user,
        )

        self.assertEqual(result.name, "defense-notes.txt")
        self.assertEqual(result.file_type, "txt")
        self.assertIn("sparse demonstrations", result.text)
        self.assertGreater(result.word_count, 5)

    async def test_llm_questions_receive_format_specific_prompt_directives(self):
        profile = AcademicProfile(
            id="real-1",
            name="Poster Expert",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        fake_llm = FakeQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            questions, diagnostics = await llm_profile_questions(
                DefenseQuestionsRequest(
                    format="poster",
                    thesis_title="Learning robust manipulation policies",
                    committee_members=[
                        CommitteeMemberRequest(name="Poster Expert", profile=profile)
                    ],
                    question_count=1,
                    use_llm=True,
                ),
                [profile],
            )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(questions[0].tag, "Pitch")
        self.assertEqual(diagnostics.accepted_count, 1)
        self.assertIn("poster presentation", fake_llm.calls[0]["system_prompt"])
        self.assertIn("busy conference poster session", fake_llm.calls[0]["system_prompt"])
        self.assertIn("Do not start questions with", fake_llm.calls[0]["system_prompt"])
        payload = json.loads(fake_llm.calls[0]["context"][0]["content"])
        self.assertEqual(payload["format_directives"]["label"], "poster presentation")
        self.assertIn("Visuals", payload["format_directives"]["coverage_tags"])
        self.assertEqual(payload["question_count"], _candidate_question_count(1))
        self.assertEqual(payload["minimum_accepted_questions"], 1)

    async def test_defense_questions_return_llm_only_success(self):
        profile = AcademicProfile(
            id="real-1",
            name="Poster Expert",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        fake_llm = FakeQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            result = await defense_route.defense_questions(
                DefenseQuestionsRequest(
                    format="poster",
                    thesis_title="Learning robust manipulation policies",
                    committee_members=[
                        CommitteeMemberRequest(name="Poster Expert", profile=profile)
                    ],
                    question_count=1,
                    use_llm=True,
                ),
                current_user=user,
            )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(result.generation_method, "llm")
        self.assertEqual(result.diagnostics.accepted_count, 1)
        self.assertEqual(result.questions[0].q, "What is the main robotic manipulation claim?")

    async def test_question_generation_retries_after_non_json_llm_response(self):
        profile = AcademicProfile(
            id="real-1",
            name="Committee Member",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        fake_llm = FakeRetryQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            questions, diagnostics = await llm_profile_questions(
                DefenseQuestionsRequest(
                    format="defense",
                    thesis_title="Learning robust manipulation policies",
                    research_summary="This project studies robotic manipulation policy evaluation.",
                    committee_members=[
                        CommitteeMemberRequest(name="Committee Member", profile=profile)
                    ],
                    question_count=2,
                    use_llm=True,
                ),
                [profile],
            )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(len(questions), 2)
        self.assertEqual(diagnostics.accepted_count, 2)
        self.assertEqual(len(fake_llm.calls), 2)
        first_payload = json.loads(fake_llm.calls[0]["context"][0]["content"])
        second_payload = json.loads(fake_llm.calls[1]["context"][0]["content"])
        self.assertGreater(first_payload["question_count"], second_payload["question_count"])

    async def test_saved_profile_sources_do_not_need_page_text(self):
        profile = AcademicProfile(
            id="real-1",
            name="Poster Expert",
            source_status="web",
            research_areas=["robotic manipulation"],
            sources=[
                AcademicProfileSource(
                    title="Poster Expert faculty page",
                    url="https://example.edu/poster-expert",
                    kind="profile",
                )
            ],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        fake_llm = FakeQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            result = await defense_route.defense_questions(
                DefenseQuestionsRequest(
                    format="poster",
                    committee_members=[
                        CommitteeMemberRequest(name="Poster Expert", profile=profile)
                    ],
                    question_count=1,
                    use_llm=True,
                ),
                current_user=user,
            )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(result.generation_method, "llm")
        self.assertEqual(result.diagnostics.accepted_count, 1)

    async def test_selected_advisor_personas_are_allowed_in_question_generation(self):
        methodologist = AcademicProfile(
            id="methodologist",
            name="Methodologist",
            title="Research Methodology Expert",
            profile_url="persona://methodologist",
            source_status="persona",
            summary="Structured and planning-focused advisor persona.",
            research_areas=["research methodology", "validity threats"],
            questioning_style=["structured methods critique"],
            question_angles=["validity threats and whether claims follow from evidence"],
            sources=[
                AcademicProfileSource(
                    title="Methodologist selected advisor persona",
                    url="persona://methodologist",
                    kind="advisor_persona",
                )
            ],
        )
        theorist = AcademicProfile(
            id="theorist",
            name="Theorist",
            title="Theoretical Frameworks Specialist",
            profile_url="persona://theorist",
            source_status="persona",
            summary="Abstract and conceptual advisor persona.",
            research_areas=["theoretical framing", "conceptual constructs"],
            questioning_style=["conceptual framing critique"],
            question_angles=["definitions, constructs, and alternative explanations"],
            sources=[
                AcademicProfileSource(
                    title="Theorist selected advisor persona",
                    url="persona://theorist",
                    kind="advisor_persona",
                )
            ],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        fake_llm = FakeMixedPanelQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            result = await defense_route.defense_questions(
                DefenseQuestionsRequest(
                    format="defense",
                    thesis_title="Learning robust manipulation policies",
                    committee_members=[
                        CommitteeMemberRequest(name="Methodologist", profile=methodologist),
                        CommitteeMemberRequest(name="Theorist", profile=theorist),
                    ],
                    question_count=2,
                    use_llm=True,
                ),
                current_user=user,
            )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(result.generation_method, "llm")
        self.assertEqual([q.member_id for q in result.questions], ["methodologist", "theorist"])
        payload = json.loads(fake_llm.calls[0]["context"][0]["content"])
        self.assertEqual(
            payload["target_question_distribution"],
            {"methodologist": 1, "theorist": 1},
        )
        self.assertIn("selected advisor persona facts", fake_llm.calls[0]["system_prompt"])

    async def test_use_llm_false_is_rejected_instead_of_falling_back(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )

        with self.assertRaises(HTTPException) as raised:
            await defense_route.defense_questions(
                DefenseQuestionsRequest(
                    format="defense",
                    committee_members=[CommitteeMemberRequest(name="Committee Member")],
                    question_count=1,
                    use_llm=False,
                ),
                current_user=user,
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["reason"], "llm_generation_required")

    async def test_unsupported_llm_question_terms_raise_diagnostics_without_backfill(self):
        profile = AcademicProfile(
            id="real-1",
            name="Committee Member",
            source_status="web",
            research_areas=["robotic manipulation"],
            question_angles=["robotic manipulation"],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        fake_llm = FakeHallucinatingQuestionLLM()
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = fake_llm
        try:
            with self.assertRaises(HTTPException) as raised:
                await defense_route.defense_questions(
                    DefenseQuestionsRequest(
                        format="defense",
                        materials=[
                            DefenseMaterial(
                                name="xlerobot-paper.txt",
                                text=(
                                    "The platform benchmarks onboard compute latency through "
                                    "camera-to-action measurements and closed-loop replanning rate. "
                                    "ACT runs at 27.8 Hz and clears the 10 Hz visuomotor task rate."
                                ),
                            )
                        ],
                        committee_members=[
                            CommitteeMemberRequest(name="Committee Member", profile=profile)
                        ],
                        question_count=1,
                        use_llm=True,
                    ),
                    current_user=user,
                )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["reason"], "no_usable_llm_questions")
        diagnostics = raised.exception.detail["diagnostics"]
        self.assertEqual(diagnostics["accepted_count"], 0)
        self.assertEqual(diagnostics["rejected_count"], 1)
        self.assertIn("proximity", diagnostics["rejections"][0]["unsupported_terms"])

    async def test_realistic_committee_questions_are_not_overfiltered(self):
        profile = AcademicProfile(
            id="nikolaus-correll",
            name="Nikolaus Correll",
            source_status="web",
            summary=(
                "Nikolaus Correll works on soft robotics, robotic materials, "
                "multi-agent systems, and integrating sensing, actuation, and "
                "computation into physical materials."
            ),
            research_areas=[
                "Soft Robotics",
                "Robotic Materials",
                "Multi-Agent Systems",
                "Human-Robot Interaction",
                "Swarm Intelligence",
            ],
        )
        request = DefenseQuestionsRequest(
            format="defense",
            thesis_title=(
                "Beyond Compute: Hardware Preconditions for Untethered Low-Cost "
                "Bimanual Mobile Manipulation"
            ),
            materials=[
                DefenseMaterial(
                    name="xlerobot-paper.txt",
                    text=(
                        "The XLeRobot-Pro platform uses SO-101 arms on a mobile base "
                        "for untethered low-cost bimanual mobile manipulation. The "
                        "paper studies power integrity, a three-bus power architecture "
                        "to prevent brownouts, a firmware torque cap, commodity servos, "
                        "and 3D-printed structural parts. It reports EV battery "
                        "disassembly as a task, a functionally graded print topology "
                        "that increases payload by 67%, a Jetson computer running "
                        "Action Chunking Transformers at 27.8 Hz, thermal benchmarks "
                        "of 54.6 C with 32 C of headroom, and print topology tradeoffs."
                        " The platform removes dependence on an external PC for control."
                    ),
                )
            ],
            committee_members=[
                CommitteeMemberRequest(name="Nikolaus Correll", profile=profile)
            ],
            question_count=6,
        )
        payload = {
            "questions": [
                {
                    "tag": "Methods",
                    "q": (
                        "You argue that physical preconditions are the primary binding "
                        "constraints for untethered autonomy, yet your solution for power "
                        "integrity relies on a 'firmware torque cap.' Given that torque is "
                        "a function of current, how does this software-level limitation "
                        "affect the robot's ability to handle the high-impedance "
                        "interactions required for tasks like the EV battery disassembly "
                        "shown in your figures?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["firmware torque cap", "EV battery disassembly"],
                },
                {
                    "tag": "Robotic Materials",
                    "q": (
                        "The functionally graded print topology you've implemented "
                        "increases payload by 67%, but in the context of material-based "
                        "intelligence, how does this increased rigidity affect the "
                        "platform's durability over long-term deployment?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["functionally graded print topology", "payload by 67%"],
                },
                {
                    "tag": "Systems",
                    "q": (
                        "You demonstrate that a Jetson can execute Action Chunking "
                        "Transformers at 27.8 Hz, but your thermal benchmarks show "
                        "54.6 C. How does the proximity of these heat-generating "
                        "electronics to the 3D-printed structural components affect "
                        "material integrity and calibration of the arms during a full load?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["Jetson", "27.8 Hz", "3D-printed structural components"],
                },
                {
                    "tag": "Reproducibility",
                    "q": (
                        "By isolating the power architecture into a three-bus system to "
                        "prevent brownouts, you've addressed a reliability hurdle for "
                        "low-cost systems. Does this added complexity in the power "
                        "distribution layer undermine the low-barrier nature of the "
                        "platform for researchers who are not hardware specialists?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["three-bus power architecture", "prevent brownouts"],
                },
                {
                    "tag": "Design Alternatives",
                    "q": (
                        "Your work focuses on rigid-body interventions to reach "
                        "XLeRobot-Pro capabilities. Looking toward compliant, "
                        "material-based robotics, could the payload constraints you "
                        "identified be better solved through integrated sensing and "
                        "soft-material distribution rather than optimizing print topology?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["XLeRobot-Pro", "print topology"],
                },
                {
                    "tag": "Future Work",
                    "q": (
                        "You've untethered the platform from an external PC, but the "
                        "current design still relies on commodity servos and 3D-printed "
                        "parts. If this were scaled to a multi-agent or swarm scenario, "
                        "how would the per-unit power integrity requirements change?"
                    ),
                    "member_id": "nikolaus-correll",
                    "member_name": "Nikolaus Correll",
                    "grounded_in": ["commodity servos", "3D-printed parts", "power integrity"],
                },
            ]
        }

        questions, diagnostics = _normalize_llm_questions(
            payload,
            [profile],
            6,
            _question_evidence_text(request, [profile]),
        )

        self.assertEqual(len(questions), 6)
        self.assertEqual(diagnostics.accepted_count, 6)
        self.assertEqual(diagnostics.rejected_count, 0)

    async def test_extra_grounded_questions_are_sampled_down_to_requested_count(self):
        profile = AcademicProfile(
            id="real-1",
            name="Committee Member",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        request = DefenseQuestionsRequest(
            format="defense",
            thesis_title="Learning robust manipulation policies",
            research_summary="This project studies robotic manipulation policy evaluation.",
            committee_members=[CommitteeMemberRequest(name="Committee Member", profile=profile)],
            question_count=2,
        )
        payload = {
            "questions": [
                {
                    "tag": "Methods",
                    "q": f"What robotic manipulation evidence supports policy claim {index}?",
                    "member_id": "real-1",
                    "member_name": "Committee Member",
                    "grounded_in": ["robotic manipulation policy evaluation"],
                }
                for index in range(6)
            ]
        }

        questions, diagnostics = _normalize_llm_questions(
            payload,
            [profile],
            2,
            _question_evidence_text(request, [profile]),
            {"real-1": 2},
        )

        self.assertEqual(len(questions), 2)
        self.assertEqual(diagnostics.accepted_count, 6)
        self.assertEqual(diagnostics.rejected_count, 0)
        self.assertTrue(all(q.q.startswith("What robotic manipulation evidence") for q in questions))

    async def test_empty_llm_response_returns_diagnostic_instead_of_json_decode_error(self):
        profile = AcademicProfile(
            id="real-1",
            name="Committee Member",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = FakeEmptyQuestionLLM()
        try:
            with self.assertRaises(HTTPException) as raised:
                await defense_route.defense_questions(
                    DefenseQuestionsRequest(
                        format="defense",
                        committee_members=[
                            CommitteeMemberRequest(name="Committee Member", profile=profile)
                        ],
                        question_count=1,
                        use_llm=True,
                    ),
                    current_user=user,
                )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["reason"], "empty_llm_response")

    async def test_plain_text_llm_response_returns_diagnostic_with_preview(self):
        profile = AcademicProfile(
            id="real-1",
            name="Committee Member",
            source_status="web",
            research_areas=["robotic manipulation"],
        )
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        original_llm = defense_route.chat_orchestrator.llm_client
        defense_route.chat_orchestrator.llm_client = FakePlainTextQuestionLLM()
        try:
            with self.assertRaises(HTTPException) as raised:
                await defense_route.defense_questions(
                    DefenseQuestionsRequest(
                        format="defense",
                        committee_members=[
                            CommitteeMemberRequest(name="Committee Member", profile=profile)
                        ],
                        question_count=1,
                        use_llm=True,
                    ),
                    current_user=user,
                )
        finally:
            defense_route.chat_orchestrator.llm_client = original_llm

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail["reason"], "non_json_llm_response")
        rejection = raised.exception.detail["diagnostics"]["rejections"][0]
        self.assertIn("unable to generate", rejection["q"])


if __name__ == "__main__":
    unittest.main()
