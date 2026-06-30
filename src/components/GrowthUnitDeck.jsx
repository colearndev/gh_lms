import React from "react";
import { Loader2, RefreshCcw, Sparkles } from "lucide-react";

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactList({ title, items }) {
  return (
    <div className="mini-section">
      <h3>{title}</h3>
      {(items.length ? items : ["Not provided"]).map((item) => (
        <p className="compact-item" key={item}>{item}</p>
      ))}
    </div>
  );
}

function LearningOutcomeList({ items, fallback }) {
  const normalized = (items || []).map((item) => {
    if (typeof item === "string") return item;
    return item.description || item.outcome || item.text || "";
  }).filter(Boolean);
  return (
    <ul className="outcome-list">
      {(normalized.length ? normalized : [fallback]).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function LessonSectionList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="lesson-section-list">
      {items.map((item, index) => (
        <section className="lesson-section" key={`${item.title || item.section_type || "section"}-${index}`}>
          <div>
            <span>{item.section_type || `section ${index + 1}`}</span>
            {item.estimated_minutes ? <em>{item.estimated_minutes} min</em> : null}
          </div>
          <h3>{item.title || `Lesson section ${index + 1}`}</h3>
          <p>{item.content}</p>
        </section>
      ))}
    </div>
  );
}

function KnowledgeCheckList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <section className="learning-block">
      <h3>Knowledge checks</h3>
      <div className="knowledge-check-list">
        {items.map((item, index) => (
          <div className="knowledge-check" key={`${item.question || "check"}-${index}`}>
            <strong>{item.question || `Check ${index + 1}`}</strong>
            {item.expected_answer ? <p>{item.expected_answer}</p> : null}
            {item.feedback ? <small>{item.feedback}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

const lengthOptions = ["<2min", "2-5min", "5-10min", "10-20min", ">20min"];

function LessonLengthControl({ value, onChange, disabled }) {
  if (!onChange) return null;
  return (
    <label className="lesson-length-control">
      <span>Lesson length</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {lengthOptions.map((item) => (
          <option value={item} key={item}>{item}</option>
        ))}
      </select>
    </label>
  );
}

export default function GrowthUnitDeck({ deck, selectedUnitId, onSelectUnit, onGenerate, loading, disabled, lessonLength, onLessonLength }) {
  const units = deck?.growth_units || [];
  const selectedUnit = units.find((unit) => unit.growth_unit_id === selectedUnitId) || units[0];
  const isCompetencyDeck = deck?.deck_type === "competency_growth_unit";
  const concept = selectedUnit?.concept_focus || selectedUnit?.competency_focus || {};
  const practiceOutcomes = selectedUnit?.practice_outcomes || selectedUnit?.knowledge_practice_outcomes || [];
  const contextText = selectedUnit?.decision_context || selectedUnit?.knowledge_context || selectedUnit?.meaning;
  const lengthLabel = selectedUnit?.estimated_minutes ? `${selectedUnit.estimated_minutes} min` : deck?.length_guide?.length_bucket || lessonLength || "5-10min";
  if (!selectedUnit) {
    return (
      <section className="growth-unit growth-unit-empty">
        <div className="growth-hero">
          <div>
            <span className="brand-kicker">Current LMS object</span>
            <h2>Generate complete Growth Unit lessons before deciding</h2>
            <p>Each lesson teaches one visible option as learning material, explains relevant knowledge and competencies, includes practice and checks, and supports the learner before they choose from the Decision Options panel.</p>
          </div>
          <div className="growth-actions">
            <LessonLengthControl value={lessonLength || "5-10min"} onChange={onLessonLength} disabled={loading} />
            <button type="button" className="primary-button growth-action" onClick={onGenerate} disabled={disabled || loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              Generate Lesson Deck
            </button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="growth-unit">
      <div className="growth-unit-header">
        <div>
          <span className="brand-kicker">{isCompetencyDeck ? "Competency Growth Unit" : "Focused Growth Unit"}</span>
          <h2>{selectedUnit.title}</h2>
        </div>
        <div className="growth-actions compact">
          <LessonLengthControl value={lessonLength || deck?.length_guide?.length_bucket || "5-10min"} onChange={onLessonLength} disabled={loading} />
          <button type="button" className="ghost-button" onClick={onGenerate} disabled={disabled || loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {isCompetencyDeck ? "Regenerate lesson" : "Regenerate lessons"}
          </button>
        </div>
      </div>
      <div className="unit-tabs">
        {units.map((unit, index) => (
          <button
            type="button"
            className={unit.growth_unit_id === selectedUnit.growth_unit_id ? "active" : ""}
            onClick={() => onSelectUnit(unit.growth_unit_id)}
            key={unit.growth_unit_id}
          >
            Lesson {index + 1}
          </button>
        ))}
      </div>
      <p className="growth-meaning">{contextText}</p>
      <div className="growth-meta">
        <Metric label={isCompetencyDeck ? "Node" : "Decision"} value={selectedUnit.target_decision_level || selectedUnit.target_node_level || deck?.highlighted_node?.level || "-"} />
        <Metric label={isCompetencyDeck ? "Competency" : "Concept"} value={concept.name || "Decision fit"} />
        <Metric label="Length" value={lengthLabel} />
        <Metric label="Lesson type" value={selectedUnit.card_type || selectedUnit.lesson_type || "learning lesson"} />
      </div>
      <section className="learning-block concept-block">
        <h3>{isCompetencyDeck ? "Competency knowledge" : "Concept knowledge"}</h3>
        <strong>{concept.name || selectedUnit.decision_question || selectedUnit.competency_question || "Decision fit"}</strong>
        <p className="compact-item">{concept.definition || selectedUnit.decision_question || selectedUnit.competency_question || "Understand what matters before continuing."}</p>
        {concept.why_it_matters_for_node ? <p className="compact-item">{concept.why_it_matters_for_node}</p> : null}
      </section>
      <LessonSectionList items={selectedUnit.lesson_sections} />
      {selectedUnit.current_level_fit ? (
        <section className="learning-block">
          <h3>Current level fit</h3>
          <p className="compact-item">Level {selectedUnit.current_level_fit.level}: {selectedUnit.current_level_fit.level_label}</p>
          <p className="compact-item">{selectedUnit.current_level_fit.what_the_learner_likely_knows}</p>
          <p className="compact-item">{selectedUnit.current_level_fit.next_understanding_step}</p>
        </section>
      ) : null}
      {selectedUnit.profile_adaptation ? (
        <section className="learning-block">
          <h3>Profile adaptation</h3>
          <p className="compact-item">{selectedUnit.profile_adaptation}</p>
        </section>
      ) : null}
      <section className="learning-block">
        <h3>Learning outcomes</h3>
        <LearningOutcomeList
          items={selectedUnit.learning_outcomes}
          fallback="The learner can explain the key concept behind this decision and use it to compare the Decision Options."
        />
      </section>
      <section className="learning-block">
        <h3>{isCompetencyDeck ? "Knowledge practice outcomes" : "Decision skill outcomes"}</h3>
        <LearningOutcomeList
          items={practiceOutcomes}
          fallback={isCompetencyDeck ? "The learner can complete a short self-check for this knowledge competency." : "The learner can choose one option from the right-side Decision Options panel and state why it fits their current goal."}
        />
      </section>
      <KnowledgeCheckList items={selectedUnit.knowledge_checks} />
      <div className="mini-section">
        <h3>Supplementary materials</h3>
        <div className="materials-grid">
          {(selectedUnit.micro_materials || []).map((item) => (
            <div className="material" key={item.title}>
              <span>{item.material_type}</span>
              <strong>{item.title}</strong>
              <p>{item.content}</p>
            </div>
          ))}
        </div>
      </div>
      {selectedUnit.lesson_completion_criteria ? (
        <section className="learning-block">
          <h3>Completion criteria</h3>
          <p className="compact-item">{selectedUnit.lesson_completion_criteria}</p>
        </section>
      ) : null}
      <CompactList title="Reflection" items={selectedUnit.reflection_questions || []} />
      <div className="next-action">{selectedUnit.recommended_next_action || "Use the Decision Options panel on the right to choose the next graph path."}</div>
    </section>
  );
}
