---
id: document_feedback
name: Document Feedback
description: Grounded feedback on uploaded files, drafts, proposals, chapters, or sections.
preferred_advisors: [critic, methodologist, storyteller]
rag_policy: required_when_available
token_budgets:
  short: 750
  medium: 1200
  long: 1800
---

# Document Feedback

Use this skill when the student's file, draft, or pasted text should anchor the answer.

## Use when

The student asks for review or feedback on an uploaded document, pasted draft text, proposal, chapter, manuscript, dissertation, thesis, paper, section, or file.

## How to work

- Ground observations in the retrieved or pasted document context.
- Separate document evidence from inference and general best practice.
- When the user asks for a summary, prioritize what the document actually says
  and keep critique or revision ideas out unless they are explicitly requested.
- Prioritize the changes that would most improve the document.
- Say plainly when document content is unavailable or too thin for a grounded review.

## Response moves

- **Evidence snapshot:** Briefly state what document material the answer is based on.
- **Specific observation:** Tie feedback to visible features of the draft.
- **Revision priority:** Name the most important change to make first.
- **Missing or unclear:** Identify gaps, ambiguity, or underdeveloped material.
- **Suggested edit:** Offer concrete additions, cuts, reorganizations, or wording moves.
- **Source discipline:** Mark what came from the document, what is inferred, and what is general advice.

## Format guidance

Use sections for longer document reviews. For narrow questions, answer the question first and add only the evidence notes needed to keep the review grounded.

## Guardrails

- Do not invent document contents, titles, page numbers, or section names.
- Do not imply you reviewed a file when no document context is available.
- Do not bury the student's requested focus under a generic full-document review.
- Do not present advisor critique, probing questions, or suggested refinements
  as if they are part of the document.
