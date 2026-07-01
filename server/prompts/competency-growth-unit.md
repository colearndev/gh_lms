# Competency Growth Unit Lesson Prompt

Return a reusable Competency Growth Unit lesson deck as strict JSON using this exact top-level shape:

```json
{{shape_json}}
```

Create one complete, useful, enjoyable LMS lesson for the selected knowledge competency.

This generator is only for competencies whose type is Knowledge. If the selected competency is not Knowledge, return the same JSON shape with `can_generate` set to `false`, `growth_units` as an empty array, and a clear reason in `generation_note`.

The lesson is LMS knowledge content, not a career decision card and not a chat answer. It should help the learner understand the selected competency well enough to continue toward the highlighted occupation/job.

## Length Requirement

```json
{{length_guide_json}}
```

Respect the requested LENGTH above. Do not produce short summaries when the requested length implies a longer lesson.

Each lesson must meet or exceed `minimum_words_per_card` across the lesson fields. Use developed paragraphs, examples, and exercises.

Populate `lesson_sections[]` as the main learning material. Include orientation, concept teaching, worked example or scenario, guided practice, self-assessment, and summary as appropriate for the length bucket.

## Competency Level Adaptation

Use the learner's current competency level as the main adaptation signal:

- level 1: introduce basic vocabulary, meaning, and simple examples.
- level 2: connect the concept to common workplace situations and guided recognition.
- level 3: explain patterns, tradeoffs, and common mistakes.
- level 4: include deeper conceptual distinctions and transfer across contexts.
- level 5: focus on expert mental models, teaching others, and nuanced application.

## Lesson Requirements

- Every `growth_units[]` item must be a full competency lesson.
- Use `card_type` `"full_competency_lesson"` and `lesson_type` `"full_lesson"`.
- Do not ask the learner to choose a graph option, do not rank occupations/jobs, and do not create decision guidance.
- The highlighted occupation/job and weighted competency evidence are context for relevance only.
- Keep the lesson focused: one clear knowledge concept, a substantial concept explanation, 2-3 explicit `learning_outcomes`, `lesson_sections`, `knowledge_checks`, `lesson_completion_criteria`, 1-2 `knowledge_practice_outcomes`, and the requested number of `micro_materials`.
- For every `lesson_sections[]` item, write substantial useful teaching content matched to the requested length.
- For every `micro_materials[]` item, write 90-180 words of useful teaching content or exercise instructions, unless the requested length is shorter.
- Every `learning_outcomes` item must start with "The learner can ..." and describe observable knowledge or understanding.

Use graph evidence when it helps explain why this knowledge matters: `highlighted_node`, selected competency score, `essential_hits`, `optional_hits`, `job_count`, and `sources`. Do not invent graph evidence.

Adapt examples to the user's goals, competencies, work history, learning agility, burnout level, and the `user_competency_level_1_to_5`.

## Next Action Rules

The `recommended_next_action` must keep the learner inside the LMS flow: review the knowledge card, mark confidence or readiness for this competency, or return to the highlighted occupation/job competency list. Do not recommend an external interview, portfolio task, or web search as the primary next action.

## Runtime Payload

```json
{{payload_json}}
```
