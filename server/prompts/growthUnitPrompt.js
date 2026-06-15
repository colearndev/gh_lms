function createGrowthUnitPrompt({ shape, lengthGuide, enrichedPayload, profileSignal }) {
  return `
Return a reusable Growth Unit card deck as strict JSON using this exact top-level shape:
${JSON.stringify(shape)}
Create 2-3 clean, useful, enjoyable learning cards. Each card must educate the learner before the current graph decision is made.
The cards are LMS content, not chat answers. They should be reusable for similar users and decisions, but personalized through profile_adaptation and examples.
Length requirement:
${JSON.stringify(lengthGuide)}
Respect the requested LENGTH above. Do not produce short summaries when the requested length implies a longer lesson.
Each card must meet or exceed minimum_words_per_card across the card fields. Use developed paragraphs, examples, and exercises.
Keep each card focused: one clear concept, a substantial decision context, 2-3 explicit learning_outcomes, 1-2 practice_outcomes, and the requested number of micro_materials.
For every micro_materials[] item, write 90-180 words of useful teaching content or exercise instructions, unless the requested length is shorter.
Every learning_outcomes item must start with "The learner can ..." and describe observable understanding or decision skill.
Teach the available choices as concepts and knowledge objects, but do not render them as selectable decision cards inside growth_units. Decision Options stay in the app's right sidebar.
Use weighted_competency_profiles as graph evidence when explaining occupation or job options. Prioritize higher score competencies, distinguish essential_hits from optional_hits, and mention competency patterns only when they help the learner understand the decision.
Adapt content length and tone to the user profile:
- if burnout or blocked level is high, keep cards shorter, lower pressure, and focus on clarity;
- if learning agility and weekly time are high, include deeper examples and a more detailed comparison task;
- use the user's goals, competencies, values, and work history as examples.
LMS concepts from docs/LMS Concepts.docx: Learning Goal gives direction; Dynamic Learning Path adapts to the individual; Learning/Growth Units are reusable educational units that support understanding, practice, reflection, and a next decision.
The next action must tell the learner to choose one of the provided graph options in the app's right-side Decision Options panel. Do not recommend an external interview, portfolio task, or web search as the primary next action.
Every option_decision_guidance item must correspond to one of the provided graph options, but keep this guidance explanatory. Do not make it a separate card list inside the growth unit.
Payload: ${JSON.stringify({ ...enrichedPayload, lengthGuide, profile: profileSignal })}
`;
}

module.exports = {
  createGrowthUnitPrompt
};
