function createCompetencyGrowthUnitPrompt({ shape, lengthGuide, enrichedPayload, profileSignal }) {
  return `
Return a reusable Competency Growth Unit card deck as strict JSON using this exact top-level shape:
${JSON.stringify(shape)}

Create 2-3 clean, useful, enjoyable learning cards for the selected knowledge competency.
This generator is only for competencies whose type is Knowledge. If the selected competency is not Knowledge, return the same JSON shape with can_generate set to false, growth_units as an empty array, and a clear reason in generation_note.

The cards are LMS knowledge content, not career decision cards and not chat answers. They should help the learner understand the selected competency well enough to continue toward the highlighted occupation/job.

Length requirement:
${JSON.stringify(lengthGuide)}
Respect the requested LENGTH above. Do not produce short summaries when the requested length implies a longer lesson.
Each card must meet or exceed minimum_words_per_card across the card fields. Use developed paragraphs, examples, and exercises.

Use the learner's current competency level as the main adaptation signal:
- level 1: introduce basic vocabulary, meaning, and simple examples;
- level 2: connect the concept to common workplace situations and guided recognition;
- level 3: explain patterns, tradeoffs, and common mistakes;
- level 4: include deeper conceptual distinctions and transfer across contexts;
- level 5: focus on expert mental models, teaching others, and nuanced application.

Every growth_units[] item must be a knowledge learning card. Use card_type values from this set only: knowledge_concept, knowledge_application, knowledge_check.
Do not ask the learner to choose a graph option, do not rank occupations/jobs, and do not create decision guidance. The highlighted occupation/job and weighted competency evidence are context for relevance only.

Keep each card focused: one clear knowledge concept, a substantial concept explanation, 2-3 explicit learning_outcomes, 1-2 knowledge_practice_outcomes, and the requested number of micro_materials.
For every micro_materials[] item, write 90-180 words of useful teaching content or exercise instructions, unless the requested length is shorter.
Every learning_outcomes item must start with "The learner can ..." and describe observable knowledge or understanding.

Use graph evidence when it helps explain why this knowledge matters: highlighted_node, selected_competency score, essential_hits, optional_hits, job_count, and sources. Do not invent graph evidence.
Adapt examples to the user's goals, competencies, work history, learning agility, burnout level, and the user_competency_level_1_to_5.

The recommended_next_action must keep the learner inside the LMS flow: review the knowledge card, mark confidence or readiness for this competency, or return to the highlighted occupation/job competency list. Do not recommend an external interview, portfolio task, or web search as the primary next action.

Payload: ${JSON.stringify({ ...enrichedPayload, lengthGuide, profile: profileSignal })}
`;
}

module.exports = {
  createCompetencyGrowthUnitPrompt
};
