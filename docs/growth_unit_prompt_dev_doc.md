# Growth Unit Generator Prompt Developer Doc

## Purpose

This document describes the Growth Unit learning-material generator prompt used by the GapHopper LMS demo. It is intended for prompt writers or external contributors who need to improve the learning material generation without changing the app contract.

The generator creates short LMS card decks that prepare a learner to make the next career-graph decision. It does not choose for the learner. It teaches the concepts, tradeoffs, competency evidence, and reflection needed before the learner selects one visible graph option.

## Material Goal

Growth Unit materials should help the learner:

- Understand what the current graph decision means.
- Compare visible Decision Options using profile evidence and graph evidence.
- Learn one reusable career-decision concept, not only read a recommendation.
- Recognize relevant competencies behind occupation or job options.
- Practice a small decision skill, such as justifying a choice or rejecting a poor-fit option.
- Return to the app ready to choose one option from the Decision Options panel.

The tone should be clear, supportive, practical, and educational. The content should avoid diagnosis, pressure, and generic motivational fluff.

## Definitions

**Learning Goal**

A direction for what the learner should understand or be able to do. In this app, the learning goal is tied to the current graph decision, such as choosing a sector, occupation family, role cluster, or job.

**Dynamic Learning Path**

The adaptive path through the career graph. The learner narrows from broad options toward more specific work roles. Each decision changes the next available graph options.

**Decision Option**

A selectable node shown in the right sidebar. Options may be sectors, occupations, or jobs. The Growth Unit must teach the learner how to compare these options, but it must not render them as separate selectable cards inside the learning material.

**Growth Unit**

A reusable educational unit that supports one graph decision. A Growth Unit is returned as a deck containing 2-3 learning cards. It includes explanation, practice, reflection, and a next action.

**Learning Unit**

A general LMS content object. In this implementation, a Growth Unit is a specific kind of Learning Unit focused on decision readiness in the career graph.

**Learning Material**

The teachable content inside a Growth Unit card: concept explanation, examples, micro-materials, exercises, reflection questions, and decision guidance.

**Micro Material**

A small content block inside a Growth Unit card. It can be a concept explanation, option concept note, mini exercise, or reflection prompt. It should be substantial enough to teach, not just label.

**Learning Outcome**

An observable understanding outcome. Every item should start with "The learner can ...".

**Practice Outcome**

An observable decision-skill outcome. It describes what the learner can practice after reading the material.

**Weighted Competency Profile**

A graph-derived evidence object for occupation/job options. It ranks ESCO and GH competencies by relevance using essential and optional requirement hits across downstream jobs.

## Runtime Flow

1. The frontend calls `POST /api/gemini/growth-unit`.
2. The backend validates that current graph options exist.
3. The backend computes a `lengthGuide` from requested length, profile signal, and learning agility.
4. If the current decision level is an occupation or job level, the backend pre-generates weighted competency profiles for up to 5 visible options.
5. The backend builds an enriched prompt payload and passes it to `createGrowthUnitPrompt`.
6. The backend normalizes the Gemini JSON into the app's expected deck shape.
7. The frontend renders the returned deck in `GrowthUnitDeck`.

## Implementation Map

Prompt and Growth Unit responsibilities are now split across dedicated files:

- `server/prompts/growthUnitPrompt.js`: owns the Gemini prompt text through `createGrowthUnitPrompt`.
- `server/index.js`: owns API routing, profile/option enrichment, weighted competency profile generation, Gemini calls, fallback decks, and output normalization.
- `src/components/GrowthUnitDeck.jsx`: owns rendering of returned Growth Unit decks.
- `src/main.jsx`: owns app state, Growth Unit generation requests, selected card state, and passing props into `GrowthUnitDeck`.
- `docs/growth_unit_prompt_dev_doc.md`: explains the prompt contract for maintainers and outsourced prompt writers.

Prompt writers should usually edit only `server/prompts/growthUnitPrompt.js` and this document. They should avoid changing `server/index.js` unless the input/output contract itself changes.

## Input Payload

The Growth Unit endpoint receives a payload like this:

```json
{
  "level": "occupation_l2",
  "profile": {},
  "options": [],
  "selectedPath": [],
  "LENGTH": "medium"
}
```

### `level`

The current graph decision level.

Expected values:

- `sector`
- `occupation_l1`
- `occupation_l2`
- `occupation_l3`
- `occupation_l4`
- `job`

### `profile`

The user profile JSON. The backend reduces this to a `profileSignal` before prompting Gemini.

Important profile signals include:

- personal goals
- competencies
- work experience
- education
- work values
- motivation
- burnout risk
- learning agility
- career awareness

### `options`

Visible Decision Options for the current graph level. The prompt usually receives up to 5 normalized options.

Important fields:

```json
{
  "code": "25",
  "uri": "http://data.europa.eu/esco/isco/C25",
  "title": "Information and communications technology professionals",
  "titleHu": "...",
  "description": "...",
  "reason": "Why AI ranked this option",
  "fitScore": 87,
  "risk": "medium"
}
```

### `selectedPath`

The learner's current path through the graph. This gives decision context.

Example:

```json
[
  { "level": "sector", "code": "J", "title": "Information and Communication" },
  { "level": "occupation_l1", "code": "2", "title": "Professionals" }
]
```

### `lengthGuide`

Generated server-side. It tells Gemini how long each card should be.

```json
{
  "requested_length": "10 minutes",
  "target_minutes_per_card": 10,
  "minimum_words_per_card": 900,
  "micro_material_count": 4,
  "guidance": "Each Growth Unit card should read like..."
}
```

### `weighted_competency_profiles`

Generated server-side for occupation/job levels only.

Each option profile includes:

```json
{
  "option_code": "2512",
  "option_title": "Software developers",
  "node_uri": "http://data.europa.eu/esco/isco/C2512",
  "downstream_job_count": 18,
  "weights": {
    "essential": 2,
    "optional": 1
  },
  "top_esco_competencies": [
    {
      "code": "S1.2.3",
      "title": "develop software prototype",
      "type": "Skill",
      "score": 42,
      "job_count": 12,
      "essential_hits": 16,
      "optional_hits": 10,
      "sources": ["software developer", "application engineer"]
    }
  ],
  "top_gh_competencies": [
    {
      "code": "gh_xxx",
      "title": "Problem solving",
      "type": "Skill",
      "score": 50,
      "job_count": 15,
      "essential_hits": 20,
      "optional_hits": 10,
      "sources": ["software developer"]
    }
  ]
}
```

Prompt writers should use this as evidence. Higher score means stronger relevance. Essential hits should be treated as stronger evidence than optional hits.

## Output Contract

Gemini must return strict JSON. The top-level shape is:

```json
{
  "deck_id": "string",
  "target_decision_level": "occupation_l2",
  "decision_context": "Current path and why this decision matters.",
  "options_available": [],
  "length_guide": {},
  "growth_units": []
}
```

Each item in `growth_units` must follow this shape:

```json
{
  "growth_unit_id": "string",
  "reusable_key": "occupation_l2:decision-literacy",
  "title": "Understand the occupation decision",
  "card_type": "decision_literacy",
  "estimated_minutes": 8,
  "profile_adaptation": "How content length, tone, and pressure level were adapted.",
  "target_decision_level": "occupation_l2",
  "user_state_snapshot": "Short profile-relevant state snapshot.",
  "decision_question": "What should the learner understand before choosing?",
  "decision_context": "Substantial explanation of why this decision matters.",
  "concept_focus": {
    "concept_id": "career-search-narrowing",
    "name": "Career search narrowing",
    "definition": "Developed concept explanation."
  },
  "learning_outcomes": [
    { "description": "The learner can ..." }
  ],
  "practice_outcomes": [
    { "description": "The learner can ..." }
  ],
  "micro_materials": [
    {
      "material_type": "concept_explanation",
      "title": "Read options as concepts",
      "content": "Substantial teaching content or exercise instructions.",
      "focus_concept": "career-search-narrowing"
    }
  ],
  "reflection_questions": [
    "Which option would make the next step clearer?"
  ],
  "option_decision_guidance": [
    {
      "option_code": "2512",
      "option_title": "Software developers",
      "when_to_choose": "Choose this when...",
      "caution": "Do not choose it only because..."
    }
  ],
  "recommended_next_action": "Review the card, then choose one option from the right-side Decision Options panel."
}
```

## Prompt Requirements

The prompt lives in `server/prompts/growthUnitPrompt.js`. It receives:

```js
createGrowthUnitPrompt({
  shape,
  lengthGuide,
  enrichedPayload,
  profileSignal
})
```

The prompt currently instructs Gemini to:

- Return strict JSON only.
- Create 2-3 Growth Unit cards.
- Make each card educational before the graph decision is made.
- Keep cards reusable, but adapt examples and tone to the profile.
- Respect `lengthGuide`.
- Write developed paragraphs, examples, and exercises.
- Include 2-3 learning outcomes and 1-2 practice outcomes per card.
- Start every learning outcome with "The learner can ...".
- Use weighted competency profiles as graph evidence for occupation/job options.
- Keep Decision Options in the app sidebar, not inside the Growth Unit as selectable cards.
- Tell the learner to choose from the app's Decision Options panel as the next action.

## Rendering In The App

The frontend renders the deck in `src/components/GrowthUnitDeck.jsx`. `src/main.jsx` imports this component and passes:

```jsx
<GrowthUnitDeck
  deck={growthDeck}
  selectedUnitId={selectedGrowthUnitId}
  onSelectUnit={setSelectedGrowthUnitId}
  onGenerate={generateGrowthUnit}
  loading={sideLoading}
  disabled={!suggestions.length}
/>
```

Rendered deck elements:

- Header: selected Growth Unit `title`.
- Regenerate button.
- Tabs: one tab per `growth_units[]` item.
- Main explanation: `decision_context` or `meaning`.
- Metadata: `target_decision_level`, `concept_focus.name`, `estimated_minutes`, `card_type`.
- Concept block: `concept_focus.name` and `concept_focus.definition`.
- Profile adaptation block: `profile_adaptation`, when present.
- Learning outcomes: `learning_outcomes[]`.
- Decision skill outcomes: `practice_outcomes[]`.
- Micro materials: `micro_materials[]`, each rendered as a small material block.
- Reflection: `reflection_questions[]`.
- Final next action: `recommended_next_action`.

Currently, `option_decision_guidance` is included in the output contract for downstream use and prompt grounding, but it is not rendered as a separate visible list in the Growth Unit deck.

## Normalization And Fallback Behavior

The backend normalizes Gemini output in `normalizeGrowthUnitDeck` in `server/index.js`.

If Gemini returns:

- an array instead of an object,
- `growthUnits` instead of `growth_units`,
- `cards` or `units` instead of `growth_units`,
- a nested `deck`,

the backend attempts to map it back to the expected deck shape.

If Gemini fails or returns invalid content, the backend can use a local fallback deck from `fallbackGrowthUnitDeck` in `server/index.js`. The fallback teaches career search narrowing and keeps the learner moving.

## Editing Boundaries

When changing the prompt:

- Keep the top-level JSON contract stable unless the frontend renderer is updated too.
- Keep `growth_units[]` as the main card list.
- Keep `learning_outcomes[]`, `practice_outcomes[]`, and `micro_materials[]` as arrays.
- Keep `recommended_next_action` focused on returning to the in-app Decision Options panel.
- Keep `weighted_competency_profiles` in the prompt payload for occupation/job levels.

When changing the renderer:

- Update `src/components/GrowthUnitDeck.jsx`.
- If a new field should be visible, add it to the output contract in this document.
- If Gemini must reliably produce that field, update `server/prompts/growthUnitPrompt.js`.

## Prompt Writer Guidance

A good generated deck should feel like a short lesson, not a recommendation memo.

Strong content:

- Teaches one decision concept clearly.
- Uses concrete evidence from visible options.
- Explains competency patterns when the option is an occupation/job.
- Connects to the learner profile without over-personalizing or diagnosing.
- Gives a small practice action.
- Ends by sending the learner back to choose one visible option.

Weak content:

- Lists options without teaching.
- Repeats the AI ranking reason.
- Recommends external actions as the primary next step.
- Ignores `weighted_competency_profiles` for occupation/job decisions.
- Produces motivational text without observable learning outcomes.
- Creates selectable cards inside the Growth Unit instead of leaving selection to the app sidebar.
