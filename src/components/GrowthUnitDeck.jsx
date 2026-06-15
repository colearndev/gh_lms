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

export default function GrowthUnitDeck({ deck, selectedUnitId, onSelectUnit, onGenerate, loading, disabled }) {
  const units = deck?.growth_units || [];
  const selectedUnit = units.find((unit) => unit.growth_unit_id === selectedUnitId) || units[0];
  const concept = selectedUnit?.concept_focus || {};
  if (!selectedUnit) {
    return (
      <section className="growth-unit growth-unit-empty">
        <div className="growth-hero">
          <div>
            <span className="brand-kicker">Current LMS object</span>
            <h2>Generate clear Growth Unit cards before deciding</h2>
            <p>Each card teaches one decision concept, explains the knowledge needed for the available choices, and gives explicit learning outcomes before the learner picks from the Decision Options panel.</p>
          </div>
          <button type="button" className="primary-button growth-action" onClick={onGenerate} disabled={disabled || loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            Generate Card Deck
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="growth-unit">
      <div className="growth-unit-header">
        <div>
          <span className="brand-kicker">Focused Growth Unit</span>
          <h2>{selectedUnit.title}</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onGenerate} disabled={disabled || loading}>
          {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
          Regenerate deck
        </button>
      </div>
      <div className="unit-tabs">
        {units.map((unit, index) => (
          <button
            type="button"
            className={unit.growth_unit_id === selectedUnit.growth_unit_id ? "active" : ""}
            onClick={() => onSelectUnit(unit.growth_unit_id)}
            key={unit.growth_unit_id}
          >
            Card {index + 1}
          </button>
        ))}
      </div>
      <p className="growth-meaning">{selectedUnit.decision_context || selectedUnit.meaning}</p>
      <div className="growth-meta">
        <Metric label="Decision" value={selectedUnit.target_decision_level} />
        <Metric label="Concept" value={concept.name || "Decision fit"} />
        <Metric label="Length" value={`${selectedUnit.estimated_minutes || 4} min`} />
        <Metric label="Card type" value={selectedUnit.card_type || "learning card"} />
      </div>
      <section className="learning-block concept-block">
        <h3>Concept knowledge</h3>
        <strong>{concept.name || selectedUnit.decision_question || "Decision fit"}</strong>
        <p className="compact-item">{concept.definition || selectedUnit.decision_question || "Understand what matters in this decision before comparing the available options."}</p>
      </section>
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
        <h3>Decision skill outcomes</h3>
        <LearningOutcomeList
          items={selectedUnit.practice_outcomes}
          fallback="The learner can choose one option from the right-side Decision Options panel and state why it fits their current goal."
        />
      </section>
      <div className="mini-section">
        <h3>Micro materials</h3>
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
      <CompactList title="Reflection" items={selectedUnit.reflection_questions || []} />
      <div className="next-action">{selectedUnit.recommended_next_action || "Use the Decision Options panel on the right to choose the next graph path."}</div>
    </section>
  );
}
