# Dify Generator App Flow Specification

## Purpose

This specification describes how the GapHopper LMS app generates career graph suggestions, Growth Unit lesson decks, competency Growth Units, and coach chat answers. It is written for rebuilding or orchestrating the backend generation flow in Dify while preserving the current app contract.

The current implementation lives in `server/index.js`, with generation services in `server/services/` and Markdown prompt templates in `server/prompts/`.

## System Overview

The app helps a learner move through a career graph:

1. Load a user profile JSON.
2. Fetch graph options from Neo4j for the current decision level.
3. Rank the visible options with an LLM selector.
4. Generate Growth Unit lessons for the current visible options.
5. Let the learner select the next graph option.
6. For occupation or job nodes, inspect weighted competency evidence.
7. Generate competency Growth Units for selected Knowledge competencies.
8. Use coach chat for concise support around the current decision and generated material.

The Dify implementation should keep graph retrieval, profile reduction, prompt assembly, generation, output validation, normalization, and caching as separate concerns.

## Backend Responsibilities

### Service Dependencies

- Neo4j stores sectors, occupations, jobs, competencies, graph relationships, and cached `LearningMaterial` nodes.
- The LLM creates JSON only. The current backend uses Gemini, but Dify can replace this layer.
- The frontend consumes stable API response shapes and should not need to know which LLM framework generated them.

### Core Backend Logic

The current Express backend performs these operations:

- Loads `.env` values for Neo4j, Gemini, model, and port.
- Normalizes graph options with `code`, `uri`, `level`, `title`, `titleHu`, and `description`.
- Reduces full user profiles into `profileSignal`.
- Computes length buckets with `growthUnitLengthGuide` and `competencyGrowthUnitLengthGuide`.
- Builds weighted competency profiles for occupation/job options.
- Builds strict output shapes before prompting.
- Renders Markdown prompt templates from `server/prompts/*.md`.
- Calls the LLM with `responseMimeType: "application/json"`.
- Extracts and parses JSON from model output.
- Normalizes partial or variant outputs into the app contract.
- Creates local fallback decks when generation fails or returns incomplete JSON.
- Reads/writes generated learning material cache records in Neo4j.

## App Flow

### 1. Status Check

Endpoint:

```text
GET /api/status
```

Output:

```json
{
  "neo4jConfigured": true,
  "neo4jConnected": true,
  "geminiConfigured": true,
  "geminiAvailable": true,
  "geminiModel": "gemini-2.5-flash-lite"
}
```

Dify note: in a Dify-native deployment this can become a health check for Neo4j plus the configured Dify workflow/app.

### 2. Load Graph Options

Endpoints:

```text
GET /api/neo4j/sectors
GET /api/neo4j/occupations?sectorCode={code}&level={1-4}
GET /api/neo4j/occupations?parentCode={code}
GET /api/neo4j/jobs?occupationCode={code}
GET /api/neo4j/jobs?parentCode={code}
```

Output shape:

```json
{
  "items": [
    {
      "level": "sector | occupation_l1 | occupation_l2 | occupation_l3 | occupation_l4 | job",
      "code": "string",
      "uri": "string",
      "title": "string",
      "titleHu": "string",
      "description": "string"
    }
  ]
}
```

Dify note: graph retrieval should usually stay outside LLM generation. Pass only normalized candidate options into the Dify workflow.

### 3. Suggest/Rerank Current Options

Endpoints:

```text
POST /api/gemini/suggest-sectors
POST /api/gemini/suggest-occupations
POST /api/gemini/suggest-jobs
```

Current prompt template:

```text
server/prompts/selector.md
```

Dify generator role:

- Rank visible graph options for the learner.
- Return exactly up to 5 suggestions.
- Copy option identity fields from the input options exactly.
- Do not invent graph nodes.
- Do not diagnose stress, burnout, or health states.

Input schema:

```json
{
  "level": "sector | occupation_l1 | occupation_l2 | occupation_l3 | occupation_l4 | job",
  "context": {
    "currentStep": "string",
    "selectedPath": [
      {
        "level": "string",
        "code": "string",
        "title": "string",
        "uri": "string"
      }
    ],
    "decisionQuestion": "string"
  },
  "profile": {},
  "options": [
    {
      "level": "string",
      "code": "string",
      "uri": "string",
      "title": "string",
      "description": "string"
    }
  ]
}
```

Backend-derived prompt variables:

```json
{
  "level": "string",
  "expected_count": 5,
  "profile_signal_json": {},
  "context_json": {},
  "options_json": []
}
```

Output schema:

```json
{
  "suggestions": [
    {
      "code": "string",
      "uri": "string",
      "title": "string",
      "titleHu": "string",
      "description": "string",
      "reason": "string",
      "fitScore": 87,
      "risk": "lower | medium | higher",
      "nextQuestion": "string"
    }
  ]
}
```

Normalization rules:

- Maximum suggestions: `min(5, options.length)`.
- Match each suggestion back to an input option by `code`, `uri`, or `title`.
- If the LLM omits options, fill remaining slots from the original options.
- Preserve original option identity fields.

### 4. Generate Option Growth Unit Deck

Endpoint:

```text
POST /api/gemini/growth-unit
```

Current prompt template:

```text
server/prompts/occupation-growth-unit.md
```

Reference output schema:

```text
docs/growth_unit_output_schema.json
```

Dify generator role:

- Generate reusable LMS lesson material for the visible Decision Options.
- Create one full lesson per option.
- Teach each option as its own concept.
- Do not rank, compare, or choose a winner inside the lesson.
- Keep the learner inside the app flow for next actions.

Input schema:

```json
{
  "level": "sector | occupation_l1 | occupation_l2 | occupation_l3 | occupation_l4 | job",
  "LENGTH": "<2min | 2-5min | 5-10min | 10-20min | >20min | short | medium | long | string",
  "estimated_minutes": 8,
  "selectedPath": [
    {
      "level": "string",
      "code": "string",
      "uri": "string",
      "title": "string"
    }
  ],
  "profile": {},
  "options": [
    {
      "level": "string",
      "code": "string",
      "uri": "string",
      "title": "string",
      "description": "string",
      "reason": "string",
      "fitScore": 87,
      "risk": "medium"
    }
  ]
}
```

Backend enrichment before generation:

```json
{
  "lengthGuide": {
    "requested_length": "string",
    "length_bucket": "<2min | 2-5min | 5-10min | 10-20min | >20min",
    "target_minutes_per_card": 8,
    "minimum_words_per_card": 700,
    "micro_material_count": 3,
    "available_length_buckets": ["<2min", "2-5min", "5-10min", "10-20min", ">20min"],
    "guidance": "string"
  },
  "profileSignal": {
    "goals": {},
    "competencies": [],
    "workExperience": [],
    "education": [],
    "workValues": [],
    "motivation": {},
    "burnout": {},
    "learningAgility": {},
    "careerAwareness": {}
  },
  "weighted_competency_profiles": [
    {
      "option_code": "string",
      "option_title": "string",
      "node_uri": "string",
      "downstream_job_count": 18,
      "weights": {
        "essential": 2,
        "optional": 1
      },
      "top_esco_competencies": [],
      "top_gh_competencies": []
    }
  ]
}
```

Length bucket logic:

```text
<2min    -> target 1 minute, 150 minimum words, 1 micro material
2-5min   -> target 4 minutes, 350 minimum words, 2 micro materials
5-10min  -> target 8 minutes, 700 minimum words, 3 micro materials
10-20min -> target 15 minutes, 1200 minimum words, 4 micro materials
>20min   -> target 25 minutes, 1800 minimum words, 5 micro materials
```

Output schema:

```json
{
  "deck_id": "string",
  "target_decision_level": "sector | occupation_l1 | occupation_l2 | occupation_l3 | occupation_l4 | job",
  "decision_context": "string",
  "options_available": [],
  "length_guide": {},
  "growth_units": [
    {
      "growth_unit_id": "string",
      "reusable_key": "string",
      "title": "string",
      "lesson_type": "full_lesson",
      "card_type": "full_option_lesson | full_competency_lesson",
      "estimated_minutes": 8,
      "profile_adaptation": "string",
      "target_decision_level": "string",
      "user_state_snapshot": "string",
      "option_focus": {
        "option_code": "string",
        "option_title": "string",
        "option_level": "string",
        "option_uri": "string"
      },
      "decision_question": "string",
      "decision_context": "string",
      "concept_focus": {
        "concept_id": "string",
        "name": "string",
        "definition": "string"
      },
      "learning_outcomes": [
        {
          "description": "The learner can ..."
        }
      ],
      "lesson_sections": [
        {
          "section_type": "orientation | concept_teaching | competency_teaching | worked_example | guided_practice | self_assessment | summary",
          "title": "string",
          "content": "string",
          "estimated_minutes": 1
        }
      ],
      "practice_outcomes": [
        {
          "description": "The learner can ..."
        }
      ],
      "micro_materials": [
        {
          "material_type": "concept_explanation | option_concept_note | competency_explanation | reflection_question | mini_exercise",
          "title": "string",
          "content": "string",
          "focus_concept": "string"
        }
      ],
      "knowledge_checks": [
        {
          "question": "string",
          "expected_answer": "string",
          "feedback": "string"
        }
      ],
      "reflection_questions": ["string"],
      "option_decision_guidance": [],
      "lesson_completion_criteria": "string",
      "recommended_next_action": "string"
    }
  ]
}
```

Normalization rules:

- Return one `growth_units[]` item per input option, max 5.
- If fewer units are returned, fill missing units from local fallback logic.
- `learning_outcomes`, `lesson_sections`, `practice_outcomes`, `micro_materials`, `knowledge_checks`, and `reflection_questions` must be non-empty.
- `option_decision_guidance` should be an empty array.
- `recommended_next_action` must point back to the in-app Decision Options panel.

Caching rules:

- Cache each option lesson separately as a Neo4j `LearningMaterial`.
- Cache key: normalized target level, option identity, and length bucket.
- Relationship: `(:Sector|Occupation|Job)-[:HAS_LEARNING_MATERIAL]->(:LearningMaterial)`.
- If all requested option lessons are cached, return the cached deck without calling Dify.
- If only some are cached, generate only missing lessons and merge with cached lessons.

### 5. Generate Weighted Competency Profile

Endpoint:

```text
POST /api/neo4j/competency-profile
```

Input schema:

```json
{
  "code": "string",
  "uri": "string",
  "essentialWeight": 2,
  "optionalWeight": 1,
  "limit": 100
}
```

Output schema:

```json
{
  "node": {
    "level": "occupation_l2 | occupation_l3 | occupation_l4 | job",
    "code": "string",
    "uri": "string",
    "title": "string",
    "description": "string"
  },
  "jobs": [],
  "competencies": [],
  "gh_competencies": [],
  "ghCompetencies": [],
  "weights": {
    "essential": 2,
    "optional": 1
  }
}
```

Backend logic:

- Resolve highlighted occupation/job by `code` or `uri`.
- Resolve downstream jobs. For a job, the downstream set is the job itself. For an occupation, traverse child jobs.
- Aggregate ESCO competencies from `RequiresCompetency`.
- Aggregate GH competencies from `GH_RequiresCompetency`.
- Score each competency by requirement hits:
  - essential hit = `essentialWeight`
  - optional hit = `optionalWeight`
- De-duplicate repeated competency/job/source hits.
- Sort by score, then essential hits, then title.

Dify note: this is graph aggregation, not LLM generation.

### 6. Generate Competency Growth Unit

Endpoint:

```text
POST /api/gemini/competency-growth-unit
```

Current prompt template:

```text
server/prompts/competency-growth-unit.md
```

Reference output schema:

```text
docs/competency_growth_unit_output_schema.json
```

Dify generator role:

- Generate an LMS knowledge lesson for one selected Knowledge competency.
- Use highlighted occupation/job context only as relevance evidence.
- Do not rank occupations/jobs.
- Do not ask the learner to select a graph option.
- If the selected competency is not Knowledge, return `can_generate: false` and no lessons.

Input schema:

```json
{
  "highlightedNode": {
    "level": "occupation_l2 | occupation_l3 | occupation_l4 | job",
    "code": "string",
    "uri": "string",
    "title": "string",
    "description": "string"
  },
  "selectedCompetency": {
    "code": "string",
    "uri": "string",
    "title": "string",
    "type": "Knowledge",
    "description": "string",
    "score": 42,
    "rank": 1,
    "job_count": 12,
    "essential_hits": 16,
    "optional_hits": 10,
    "sources": ["string"]
  },
  "user_competency_level_1_to_5": 1,
  "LENGTH": "5-10min",
  "profile": {}
}
```

Output schema:

```json
{
  "deck_id": "string",
  "deck_type": "competency_growth_unit",
  "can_generate": true,
  "generation_note": "string",
  "highlighted_node": {},
  "selected_competency": {},
  "user_competency_level_1_to_5": 1,
  "level_interpretation": "string",
  "length_guide": {},
  "growth_units": [
    {
      "growth_unit_id": "string",
      "reusable_key": "string",
      "title": "string",
      "lesson_type": "full_lesson",
      "card_type": "full_competency_lesson",
      "estimated_minutes": 8,
      "profile_adaptation": "string",
      "target_node_level": "occupation_l2 | occupation_l3 | occupation_l4 | job",
      "user_state_snapshot": "string",
      "competency_question": "string",
      "knowledge_context": "string",
      "competency_focus": {
        "competency_id": "string",
        "name": "string",
        "type": "Knowledge",
        "definition": "string",
        "why_it_matters_for_node": "string"
      },
      "current_level_fit": {
        "level": 1,
        "level_label": "novice | basic | working | advanced | expert",
        "what_the_learner_likely_knows": "string",
        "next_understanding_step": "string"
      },
      "learning_outcomes": [
        {
          "description": "The learner can ..."
        }
      ],
      "knowledge_practice_outcomes": [
        {
          "description": "The learner can ..."
        }
      ],
      "lesson_sections": [],
      "micro_materials": [],
      "knowledge_checks": [],
      "lesson_completion_criteria": "string",
      "reflection_questions": ["string"],
      "recommended_next_action": "string"
    }
  ]
}
```

Competency level interpretation:

```text
1 -> novice
2 -> basic
3 -> working
4 -> advanced
5 -> expert
```

Normalization rules:

- `deck_type` must be `competency_growth_unit`.
- `card_type` must be `full_competency_lesson`.
- For non-Knowledge competencies, return `can_generate: false`, a clear `generation_note`, and `growth_units: []`.
- For Knowledge competencies, return one full lesson.
- Required arrays must be non-empty: `learning_outcomes`, `knowledge_practice_outcomes`, `lesson_sections`, `micro_materials`, `knowledge_checks`, `reflection_questions`.
- `recommended_next_action` must keep the learner inside the LMS flow.

Caching rules:

- Cache one competency Growth Unit per highlighted node, selected competency, and length bucket.
- Relationship from target: `(:Occupation|Job)-[:HAS_CONTEXTUAL_LEARNING_MATERIAL]->(:LearningMaterial)`.
- Relationship from competency: `(:Competency|GH_Competency)-[:HAS_LEARNING_MATERIAL]->(:LearningMaterial)`.

### 7. Coach Chat

Endpoint:

```text
POST /api/gemini/chat
```

Current prompt template:

```text
server/prompts/chat.md
```

Dify generator role:

- Return concise coaching support.
- Use the current context.
- Do not diagnose mental or health states.
- Return JSON only.

Input schema:

```json
{
  "message": "string",
  "selectedPath": [],
  "currentOptions": [],
  "profile": {},
  "growthUnitSummary": {}
}
```

Output schema:

```json
{
  "message": "string"
}
```

## Prompt Files

The backend prompt factories render these Markdown files:

```text
server/prompts/selector.md
server/prompts/occupation-growth-unit.md
server/prompts/competency-growth-unit.md
server/prompts/chat.md
```

The JavaScript prompt factories are compatibility wrappers:

```text
server/prompts/selectorPrompt.js
server/prompts/growthUnitPrompt.js
server/prompts/competencyGrowthUnitPrompt.js
server/prompts/chatPrompt.js
```

For Dify, copy the Markdown prompt text into the matching workflow LLM node and map the template variables to Dify variables.

## Dify Workflow Mapping

### Selector Workflow

Inputs:

- `level`
- `expected_count`
- `profile_signal_json`
- `context_json`
- `options_json`

LLM prompt:

- `server/prompts/selector.md`

Output parser:

- JSON object with `suggestions`.

Post-processing:

- Match suggestions to input options.
- Fill missing options.
- Enforce max 5 suggestions.

### Option Growth Unit Workflow

Inputs:

- `shape_json`
- `length_guide_json`
- `payload_json`

LLM prompt:

- `server/prompts/occupation-growth-unit.md`

Output parser:

- JSON object matching `docs/growth_unit_output_schema.json`.

Post-processing:

- Normalize aliases such as `growthUnits`, `units`, or `cards` into `growth_units`.
- Fill missing lessons from fallback logic.
- Write successful lessons to Neo4j cache.

### Competency Growth Unit Workflow

Inputs:

- `shape_json`
- `length_guide_json`
- `payload_json`

LLM prompt:

- `server/prompts/competency-growth-unit.md`

Output parser:

- JSON object matching `docs/competency_growth_unit_output_schema.json`.

Post-processing:

- Enforce non-Knowledge guard.
- Normalize lesson arrays.
- Write successful lessons to Neo4j cache.

### Chat Workflow

Inputs:

- `context_json`

LLM prompt:

- `server/prompts/chat.md`

Output parser:

- JSON object with `message`.

## Required Dify Guardrails

- All LLM nodes must return JSON only.
- Do not invent graph nodes, option names, competency names, codes, or URIs.
- Keep health, burnout, and stress references non-diagnostic.
- Preserve app navigation language:
  - option Growth Units should send the learner back to the right-side Decision Options panel.
  - competency Growth Units should send the learner back to the highlighted occupation/job competency list.
- External interviews, portfolio tasks, and web search must not be primary next actions.
- Growth Units are LMS lessons, not recommendation memos.
- Selector output may rank options, but lesson output must not create comparison tables, winner/loser language, or pros/cons matrices.

## Error and Fallback Behavior

Expected backend errors:

```json
{
  "error": "string"
}
```

Common status behavior:

- `400`: required identifier or highlighted node is missing.
- `422`: no graph options are available for generation.
- `502`: LLM returned invalid or empty JSON.
- `503`: required service is not configured.

Fallback behavior:

- For option Growth Units, generate a local fallback deck if the LLM output is missing or incomplete.
- For competency Growth Units, generate a local fallback deck for Knowledge competencies.
- For non-Knowledge competencies, return `can_generate: false`.
- For selector suggestions, fill missing suggestion slots from available graph options.

## Implementation Checklist

- Keep Neo4j graph reads outside Dify unless Dify is explicitly connected to the graph.
- Compute `profileSignal` before calling Dify.
- Compute `lengthGuide` before calling Dify.
- Build weighted competency profiles before option Growth Unit generation for occupation/job levels.
- Pass strict `shape_json` into Growth Unit prompts.
- Validate and normalize every Dify JSON output before returning it to the frontend.
- Preserve Neo4j learning material cache behavior to avoid regenerating the same lesson repeatedly.
