# Growth Unit Lesson Deck Prompt

Return a reusable Growth Unit lesson deck as strict JSON using this exact top-level shape:

```json
{{shape_json}}
```

Create exactly one complete Growth Unit lesson for each provided option in `options_available`. If there are 5 options, return 5 `growth_units` in the same order.

Each `growth_units[]` item must be a full LMS lesson about its own selected element: sector, occupation, or job. Do not create a comparison-style lesson and do not make one shared lesson that compares all options.

The lessons are LMS learning material, not chat answers, not recommendation memos, and not lightweight flash cards. They should be reusable for similar users and decisions, but personalized through `profile_adaptation` and examples.

## Length Requirement

```json
{{length_guide_json}}
```

Respect the quantized LENGTH bucket above: `<2min`, `2-5min`, `5-10min`, `10-20min`, or `>20min`. Do not produce short summaries when the requested bucket implies a longer lesson.

Each lesson must meet or exceed `minimum_words_per_card` across the lesson fields. Use developed paragraphs, examples, exercises, checks, and completion criteria.

## Lesson Requirements

- Keep each lesson focused on one option: one clear option concept, a substantial standalone explanation, 2-3 explicit `learning_outcomes`, 1-2 `practice_outcomes`, and the requested number of `micro_materials`.
- Populate `lesson_sections[]` as the main learning material.
- Include orientation, concept teaching, competency teaching for occupation/job options, worked example or scenario, guided practice, self-assessment, and summary as appropriate for the length bucket.
- For every `lesson_sections[]` item, write full teaching paragraphs.
- For every `micro_materials[]` item, write 90-180 words of useful teaching content or exercise instructions, unless the requested length is shorter.
- Include `knowledge_checks[]` with questions, expected answers, and feedback so the learner can verify understanding inside the LMS.
- Include `lesson_completion_criteria` explaining what the learner can do when the lesson is complete.
- Every `learning_outcomes` item must start with "The learner can ..." and describe observable understanding or decision skill.

Teach each available choice as its own concept and knowledge object, but do not rank it against the other options inside the lesson. Decision Options stay in the app's right sidebar.

For occupation or job options, add explanatory material for that option's top competencies using `weighted_competency_profiles`. Prioritize higher score competencies, distinguish `essential_hits` from `optional_hits`, and explain what the competency pattern means for learning the occupation/job. Do not invent competencies.

## Profile Adaptation

- If burnout or blocked level is high, keep lessons within the selected length bucket, lower pressure, and focus on clarity.
- If learning agility and weekly time are high, include deeper examples and a more detailed competency or fit reflection task.
- Use the user's goals, competencies, values, and work history as examples.

## LMS Concepts

Learning Goal gives direction. Dynamic Learning Path adapts to the individual. Learning/Growth Units are reusable educational units that support understanding, practice, reflection, and a next decision.

## Next Action Rules

The next action must tell the learner to complete the lesson, then select this lesson's option from the app's right-side Decision Options panel only if the explanation and evidence fit. Do not recommend an external interview, portfolio task, or web search as the primary next action.

Set `option_decision_guidance` to an empty array unless the shape requires otherwise. Do not create comparison tables, rankings, pros/cons matrices, or winner/loser language.

## Runtime Payload

```json
{{payload_json}}
```
