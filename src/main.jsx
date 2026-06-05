import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Database,
  History,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  Sparkles,
  Target,
  Upload
} from "lucide-react";
import mockProfile from "../docs/user_profile_mock_1.json";
import "./styles.css";

const levels = [
  { id: "sector", label: "Sector" },
  { id: "occupation_l1", label: "Occupation L1" },
  { id: "occupation_l2", label: "Occupation L2" },
  { id: "occupation_l3", label: "Occupation L3" },
  { id: "occupation_l4", label: "Occupation L4" },
  { id: "job", label: "Job" }
];

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function getProfileRoot(profile) {
  return profile?.user_profile_analysis || profile || {};
}

function valueOf(field, fallback = "Not provided") {
  if (field == null) return fallback;
  if (typeof field === "string" || typeof field === "number") return field;
  if (field.value != null) return valueOf(field.value, fallback);
  if (field.label) return field.label;
  if (field.type) return field.type;
  return fallback;
}

function profileSections(profile) {
  const root = getProfileRoot(profile);
  const personal = root.personal_profile || root.categories?.personal_profile || {};
  const professional = root.professional_profile || root.categories?.professional_profile || {};
  const self = root.self_awareness || root.categories?.self_awareness || {};
  const cv = professional.cv || {};
  return {
    name: `${valueOf(personal.first_name, "")} ${valueOf(personal.last_name, "")}`.trim() || "Profile",
    primaryGoal: valueOf(personal.personal_goals?.primary_goal),
    secondaryGoal: valueOf(personal.personal_goals?.secondary_goal),
    lifeStage: valueOf(personal.life_stage),
    competencies: personal.competency_map_pcpv?.competencies || [],
    workExperience: cv.work_experience || [],
    education: cv.education || [],
    workValues: professional.work_values || [],
    motivation: self.personal_motivation_pcpv?.motivators || [],
    burnout: self.burnout_index_pcpv || {},
    learningAgility: self.learning_agility_onboarding || self.learning_agility_pcpv_medium || {},
    careerAwareness: self.career_awareness || {}
  };
}

function AppShell({ children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-kicker">GapHopper LMS</span>
          <h1>Career Growth Unit Explorer</h1>
        </div>
        <div className="topbar-meta">
          <Target size={18} />
          <span>Profile to graph-guided decisions</span>
        </div>
      </header>
      {children}
    </div>
  );
}

function ProfileInput({ rawProfile, onRawProfile, onApply, parseError }) {
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onRawProfile(String(reader.result || ""));
    reader.readAsText(file);
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <Upload size={18} />
        <h2>Profile Input</h2>
      </div>
      <textarea
        className="json-input"
        value={rawProfile}
        onChange={(event) => onRawProfile(event.target.value)}
        spellCheck="false"
      />
      {parseError ? <ErrorPanel message={parseError} /> : null}
      <div className="button-row">
        <label className="ghost-button">
          <Upload size={16} />
          <input type="file" accept="application/json,.json" onChange={upload} />
          Upload
        </label>
        <button type="button" className="primary-button" onClick={onApply}>
          <Check size={16} />
          Apply Profile
        </button>
      </div>
    </section>
  );
}

function ProfileSummary({ profile }) {
  const s = profileSections(profile);
  return (
    <section className="panel">
      <div className="panel-title">
        <Target size={18} />
        <h2>{s.name}</h2>
      </div>
      <Metric label="Primary goal" value={s.primaryGoal} />
      <Metric label="Secondary goal" value={s.secondaryGoal} />
      <Metric label="Life stage" value={s.lifeStage} />
      <ChipList title="Competencies" items={s.competencies.map((item) => `${item.label || item.competency_id} L${item.level ?? "-"}`)} />
      <ChipList title="Work values" items={s.workValues.map((item) => `${item.label} ${item.score ?? ""}`)} />
      <ChipList title="Motivation" items={s.motivation.map((item) => `${item.label} ${item.score ?? ""}`)} />
      <CompactList title="Experience" items={s.workExperience.map((item) => `${item.title || "Role"} · ${item.company || "Company"}`)} />
      <CompactList title="Education" items={s.education.map((item) => `${item.degree || item.level || "Education"} · ${item.field || item.institution || ""}`)} />
      <div className="signal-grid">
        <Signal label="Burnout" value={s.burnout.risk_level || s.burnout.score || "-"} />
        <Signal label="Agility" value={s.learningAgility.score || s.learningAgility.personal_learning_pace || "-"} />
        <Signal label="Awareness" value={s.careerAwareness.score || "-"} />
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Signal({ label, value }) {
  return (
    <div className="signal">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChipList({ title, items }) {
  return (
    <div className="mini-section">
      <h3>{title}</h3>
      <div className="chips">
        {(items.length ? items : ["Not provided"]).map((item) => (
          <span className="chip" key={item}>{item}</span>
        ))}
      </div>
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

function ExplorationStepper({ currentLevel }) {
  const current = levels.findIndex((level) => level.id === currentLevel);
  return (
    <nav className="stepper">
      {levels.map((level, index) => (
        <div className={`step ${index === current ? "active" : ""} ${index < current ? "done" : ""}`} key={level.id}>
          <span>{index + 1}</span>
          <p>{level.label}</p>
        </div>
      ))}
    </nav>
  );
}

function SuggestionCards({ suggestions, onSelect, loading, level, canChoose }) {
  if (loading) return <LoadingState label="Building suggestions from profile and graph options" />;
  if (!suggestions.length) {
    return <div className="empty-state">No AI suggestions generated. Neo4j and Gemini must both be available.</div>;
  }
  return (
    <div className="suggestions">
      {suggestions.map((item) => {
        const score = item.fitScore ?? item.score ?? item.fit_score ?? "-";
        const title = item.title || item.Title || "Untitled option";
        const code = item.code || item.Code || item.uri || "Option";
        const description = item.description || item.Description || item.reason || "No description returned.";
        const reason = item.reason || item.fitReason || item.explanation || "No reason returned.";
        const risk = item.risk || "medium";
        return (
          <article className="suggestion-card" key={`${level}-${code}-${title}`}>
            <div className="card-heading">
              <div>
                <span className="code">{code}</span>
                <h3>{title}</h3>
              </div>
              <span className="score">{score}</span>
            </div>
            <p>{description}</p>
            <div className="reason">{reason}</div>
            <div className="card-footer">
              <span className={`risk ${risk}`}>{risk} risk</span>
              <button type="button" onClick={() => onSelect(item)} disabled={!canChoose}>
                {canChoose ? "Choose" : "Review cards"} <ChevronRight size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GrowthUnitDeck({ deck, selectedUnitId, onSelectUnit, onGenerate, onSelectOption, loading, disabled }) {
  const units = deck?.growth_units || [];
  const selectedUnit = units.find((unit) => unit.growth_unit_id === selectedUnitId) || units[0];
  if (!selectedUnit) {
    return (
      <section className="growth-unit growth-unit-empty">
        <div className="growth-hero">
          <div>
            <span className="brand-kicker">Current LMS object</span>
            <h2>Generate reusable Growth Unit cards before deciding</h2>
            <p>Each card teaches one decision concept for this graph stage, adapted to the learner profile. The learner chooses a deeper graph path only after reviewing the cards.</p>
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
          <span className="brand-kicker">Reusable Growth Unit Cards</span>
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
        <Metric label="Focus" value={selectedUnit.concept_focus?.name || "Decision fit"} />
        <Metric label="Length" value={`${selectedUnit.estimated_minutes || 4} min`} />
        <Metric label="Card type" value={selectedUnit.card_type || "learning card"} />
      </div>
      {selectedUnit.profile_adaptation ? (
        <section className="learning-block">
          <h3>Profile adaptation</h3>
          <p className="compact-item">{selectedUnit.profile_adaptation}</p>
        </section>
      ) : null}
      <section className="learning-block">
        <h3>Learning outcomes</h3>
        {(selectedUnit.learning_outcomes || []).map((item) => (
          <p className="compact-item" key={item.description}>{item.description}</p>
        ))}
      </section>
      <section className="learning-block">
        <h3>Practice outcomes</h3>
        {(selectedUnit.practice_outcomes || []).map((item) => (
          <p className="compact-item" key={item.description}>{item.description}</p>
        ))}
      </section>
      <section className="unit-options">
        <div className="panel-title">
          <ChevronRight size={18} />
          <h3>Choose the next graph path after this card</h3>
        </div>
        {(selectedUnit.options_compared || deck.options_available || []).map((item) => {
          const title = item.title || item.Title || item.name || item.label || "Untitled option";
          const code = item.code || item.Code || item.uri || title;
          const reason = item.reason || item.fitReason || item.explanation || item.nextQuestion || "";
          const risk = item.risk || "medium";
          return (
            <article className="unit-option" key={`${code}-${title}`}>
              <div>
                <span className="code">{code}</span>
                <strong>{title}</strong>
                {reason ? <p>{reason}</p> : null}
              </div>
              <button type="button" onClick={() => onSelectOption(item)}>
                Choose this path <ChevronRight size={16} />
              </button>
              <span className={`risk ${risk}`}>{risk} risk</span>
            </article>
          );
        })}
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
      <div className="next-action">{selectedUnit.recommended_next_action}</div>
    </section>
  );
}

function Graph3D({ currentLevel, history, suggestions }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const width = mount.clientWidth || 720;
    const height = mount.clientHeight || 260;
    mount.innerHTML = "";
    let renderer;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf7fafa);

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.set(0, 4.5, 10);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const light = new THREE.DirectionalLight(0xffffff, 0.7);
      light.position.set(4, 7, 5);
      scene.add(light);

      const nodeMaterial = new THREE.MeshStandardMaterial({ color: 0x8fb9b4, roughness: 0.42 });
      const chosenMaterial = new THREE.MeshStandardMaterial({ color: 0x1f6f67, roughness: 0.35 });
      const activeMaterial = new THREE.MeshStandardMaterial({ color: 0xd39d45, roughness: 0.32 });
      const optionMaterial = new THREE.MeshStandardMaterial({ color: 0x6f8790, roughness: 0.55 });
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0x789196 });

      const points = levels.map((level, index) => ({
        level,
        position: new THREE.Vector3((index - 2.5) * 1.7, 0, 0),
        chosen: history.find((item) => item.level === level.id),
        active: level.id === currentLevel
      }));

      points.forEach((point, index) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(point.active ? 0.24 : 0.18, 32, 16),
          point.active ? activeMaterial : point.chosen ? chosenMaterial : nodeMaterial
        );
        mesh.position.copy(point.position);
        scene.add(mesh);

        if (index > 0) {
          const geometry = new THREE.BufferGeometry().setFromPoints([points[index - 1].position, point.position]);
          scene.add(new THREE.Line(geometry, lineMaterial));
        }
      });

      const activePoint = points.find((point) => point.active) || points[0];
      suggestions.slice(0, 5).forEach((suggestion, index) => {
        const angle = ((index - 2) / 5) * Math.PI;
        const optionPosition = activePoint.position.clone().add(new THREE.Vector3(Math.sin(angle) * 1.7, -1.25, Math.cos(angle) * 1.2));
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12), optionMaterial);
        mesh.position.copy(optionPosition);
        scene.add(mesh);
        const geometry = new THREE.BufferGeometry().setFromPoints([activePoint.position, optionPosition]);
        scene.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xd39d45 })));
      });

      let frame;
      function animate() {
        frame = requestAnimationFrame(animate);
        scene.rotation.y += 0.0025;
        renderer.render(scene, camera);
      }
      animate();

      return () => {
        cancelAnimationFrame(frame);
        renderer.dispose();
        mount.innerHTML = "";
      };
    } catch (error) {
      drawIsometricGraphFallback(mount, width, height, currentLevel, history, suggestions);
      return () => {
        mount.innerHTML = "";
      };
    }
  }, [currentLevel, history, suggestions]);

  return (
    <section className="graph-3d-panel">
      <div className="panel-title">
        <Database size={18} />
        <h2>3D Path Graph</h2>
      </div>
      <div className="graph-3d-canvas" ref={mountRef} />
      <div className="graph-legend">
        <span><i className="chosen-dot" /> chosen path</span>
        <span><i className="active-dot" /> current stage</span>
        <span><i className="option-dot" /> available deeper options</span>
      </div>
    </section>
  );
}

function drawIsometricGraphFallback(mount, width, height, currentLevel, history, suggestions) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "graph-fallback-canvas";
  mount.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7fafa";
  ctx.fillRect(0, 0, width, height);

  const y = height * 0.48;
  const spacing = width / 7;
  const nodes = levels.map((level, index) => ({
    x: spacing * (index + 1),
    y: y + (index % 2 ? -18 : 18),
    chosen: history.find((item) => item.level === level.id),
    active: level.id === currentLevel,
    label: level.label
  }));

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#789196";
  ctx.beginPath();
  nodes.forEach((node, index) => {
    if (index === 0) ctx.moveTo(node.x, node.y);
    else ctx.lineTo(node.x, node.y);
  });
  ctx.stroke();

  nodes.forEach((node) => {
    ctx.beginPath();
    ctx.fillStyle = node.active ? "#d39d45" : node.chosen ? "#1f6f67" : "#8fb9b4";
    ctx.arc(node.x, node.y, node.active ? 16 : 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#263739";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.label, node.x, node.y + 34);
  });

  const activeNode = nodes.find((node) => node.active) || nodes[0];
  suggestions.slice(0, 5).forEach((option, index) => {
    const ox = activeNode.x + (index - 2) * 38;
    const oy = activeNode.y + 78 + Math.abs(index - 2) * 8;
    ctx.strokeStyle = "#d39d45";
    ctx.beginPath();
    ctx.moveTo(activeNode.x, activeNode.y);
    ctx.lineTo(ox, oy);
    ctx.stroke();
    ctx.fillStyle = "#6f8790";
    ctx.beginPath();
    ctx.arc(ox, oy, 8, 0, Math.PI * 2);
    ctx.fill();
  });
}

function GraphPosition({ currentLevel, history, suggestions }) {
  const currentIndex = levels.findIndex((level) => level.id === currentLevel);
  const activeLabel = levels[currentIndex]?.label || "Decision";
  return (
    <section className="graph-position">
      <div className="panel-title">
        <Database size={18} />
        <h2>Graph Position</h2>
      </div>
      <div className="graph-track">
        {levels.map((level, index) => {
          const chosen = history.find((item) => item.level === level.id);
          const active = level.id === currentLevel;
          return (
            <div className={`graph-node ${active ? "active" : ""} ${chosen ? "chosen" : ""}`} key={level.id}>
              <span>{index + 1}</span>
              <strong>{level.label}</strong>
              <p>{chosen?.title || (active ? "Current decision" : "Not reached")}</p>
            </div>
          );
        })}
      </div>
      <div className="graph-current">
        <div>
          <span className="brand-kicker">Now</span>
          <strong>{activeLabel}</strong>
        </div>
        <div>
          <span className="brand-kicker">Available options</span>
          <strong>{suggestions.length}</strong>
        </div>
      </div>
    </section>
  );
}

function ChatPanel({ messages, onSend, loading }) {
  const [text, setText] = useState("");
  function submit(event) {
    event.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }
  return (
    <section className="panel chat-panel">
      <div className="panel-title">
        <MessageSquare size={18} />
        <h2>Coach Chat</h2>
      </div>
      <div className="messages">
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>
        ))}
        {loading ? <div className="message assistant"><Loader2 className="spin" size={16} /> Thinking</div> : null}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask about this decision" />
        <button type="submit" aria-label="Send message"><Send size={17} /></button>
      </form>
    </section>
  );
}

function DecisionHistory({ history, onReset }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <History size={18} />
        <h2>Decision History</h2>
      </div>
      {history.length ? history.map((item, index) => (
        <div className="history-item" key={`${item.level}-${item.code}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.title}</strong>
            <p>{item.level} · {item.code}</p>
          </div>
        </div>
      )) : <div className="empty-state small">No decision selected yet.</div>}
      <button type="button" className="ghost-button full" onClick={onReset}>
        <RefreshCcw size={16} />
        Reset path
      </button>
    </section>
  );
}

function Neo4jStatus({ status }) {
  return (
    <section className="status-strip">
      <Database size={18} />
      <span>Neo4j {status?.neo4jConnected ? "connected" : status?.neo4jConfigured ? "configured but not connected" : "not configured"}</span>
      <Bot size={18} />
      <span>Gemini {status?.geminiAvailable ? "available" : status?.geminiConfigured ? "configured but unavailable" : "not configured"}</span>
    </section>
  );
}

function ServiceWarning({ status }) {
  if (!status) return null;
  const missing = [];
  if (!status.neo4jConnected) missing.push("Neo4j");
  if (!status.geminiAvailable) missing.push("Gemini AI");
  if (!missing.length) return null;
  return (
    <div className="service-warning">
      <AlertCircle size={18} />
      <span>{missing.join(" and ")} {missing.length === 1 ? "is" : "are"} not available. The app will not generate graph options, AI suggestions, chat answers, or Growth Units until the missing service is configured and the app is restarted.</span>
    </div>
  );
}

function LoadingState({ label }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

function ErrorPanel({ message }) {
  return (
    <div className="error-panel">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  );
}

function App() {
  const [rawProfile, setRawProfile] = useState(JSON.stringify(mockProfile, null, 2));
  const [profile, setProfile] = useState(mockProfile);
  const [parseError, setParseError] = useState("");
  const [status, setStatus] = useState(null);
  const [currentLevel, setCurrentLevel] = useState("sector");
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [growthDeck, setGrowthDeck] = useState(null);
  const [selectedGrowthUnitId, setSelectedGrowthUnitId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sideLoading, setSideLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Chat is available after Gemini AI is configured." }
  ]);

  const context = useMemo(() => ({
    selectedSector: history.find((item) => item.level === "sector") || null,
    selectedOccupationPath: history.filter((item) => item.level.startsWith("occupation")),
    selectedJobPath: history.filter((item) => item.level === "job")
  }), [history]);

  useEffect(() => {
    api("/api/status").then(setStatus).catch(() => setStatus({}));
  }, []);

  useEffect(() => {
    loadLevel(currentLevel);
  }, [currentLevel, profile]);

  function applyProfile() {
    try {
      const parsed = JSON.parse(rawProfile);
      setProfile(parsed);
      setParseError("");
      setGrowthDeck(null);
      setSelectedGrowthUnitId(null);
      setHistory([]);
      setCurrentLevel("sector");
    } catch (err) {
      setParseError(err.message);
    }
  }

  async function loadLevel(level) {
    setLoading(true);
    setError("");
    setGrowthDeck(null);
    setSelectedGrowthUnitId(null);
    try {
      let options = [];
      let endpoint = "/api/gemini/suggest-occupations";
      if (level === "sector") {
        options = (await api("/api/neo4j/sectors")).items;
        endpoint = "/api/gemini/suggest-sectors";
      } else if (level === "job") {
        const parent = history[history.length - 1];
        const path = parent?.level === "job"
          ? `/api/neo4j/jobs?parentCode=${encodeURIComponent(parent.code)}`
          : `/api/neo4j/jobs?occupationCode=${encodeURIComponent(parent?.code || "")}`;
        options = (await api(path)).items;
        endpoint = "/api/gemini/suggest-jobs";
      } else {
        const levelNumber = level.replace("occupation_l", "");
        const parent = history[history.length - 1];
        const sector = history.find((item) => item.level === "sector");
        const path = parent?.level?.startsWith("occupation")
          ? `/api/neo4j/occupations?parentCode=${encodeURIComponent(parent.code)}`
          : `/api/neo4j/occupations?sectorCode=${encodeURIComponent(sector?.code || "")}&level=${levelNumber}`;
        options = (await api(path)).items;
      }

      const ranked = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ profile, options, context, level })
      });
      setSuggestions(ranked.suggestions || []);
    } catch (err) {
      setError(err.message);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  async function choose(item) {
    const nextHistory = [...history, { ...item, level: currentLevel }];
    setHistory(nextHistory);
    setSuggestions([]);
    setGrowthDeck(null);
    setSelectedGrowthUnitId(null);
    const index = levels.findIndex((level) => level.id === currentLevel);
    setCurrentLevel(levels[Math.min(index + 1, levels.length - 1)].id);
  }

  async function generateGrowthUnit() {
    setSideLoading(true);
    try {
      const deck = await api("/api/gemini/growth-unit", {
        method: "POST",
        body: JSON.stringify({ level: currentLevel, profile, options: suggestions, selectedPath: history })
      });
      setGrowthDeck(deck);
      setSelectedGrowthUnitId(deck.growth_units?.[0]?.growth_unit_id || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSideLoading(false);
    }
  }

  async function sendChat(text) {
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setSideLoading(true);
    try {
      const result = await api("/api/gemini/chat", {
        method: "POST",
        body: JSON.stringify({ text, profile, currentLevel, suggestions, history, growthDeck, messages: nextMessages })
      });
      setMessages([...nextMessages, { role: "assistant", content: result.message }]);
    } catch (err) {
      setMessages([...nextMessages, { role: "assistant", content: err.message }]);
    } finally {
      setSideLoading(false);
    }
  }

  function resetPath() {
    setHistory([]);
    setCurrentLevel("sector");
    setGrowthDeck(null);
    setSelectedGrowthUnitId(null);
  }

  return (
    <AppShell>
      <Neo4jStatus status={status} />
      <ServiceWarning status={status} />
      <main className="workspace">
        <aside className="left-column">
          <ProfileInput rawProfile={rawProfile} onRawProfile={setRawProfile} onApply={applyProfile} parseError={parseError} />
          <ProfileSummary profile={profile} />
          <DecisionHistory history={history} onReset={resetPath} />
        </aside>
        <section className="center-column">
          <Graph3D currentLevel={currentLevel} history={history} suggestions={suggestions} />
          <GraphPosition currentLevel={currentLevel} history={history} suggestions={suggestions} />
          <div className="level-header">
            <div>
              <span>Growth Unit workspace</span>
              <h2>{levels.find((level) => level.id === currentLevel)?.label}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => loadLevel(currentLevel)}>
              <RefreshCcw size={16} />
              Refresh options
            </button>
          </div>
          {error ? <ErrorPanel message={error} /> : null}
          <GrowthUnitDeck deck={growthDeck} selectedUnitId={selectedGrowthUnitId} onSelectUnit={setSelectedGrowthUnitId} onGenerate={generateGrowthUnit} onSelectOption={choose} loading={sideLoading} disabled={!suggestions.length} />
        </section>
        <aside className="right-column">
          <section className="panel">
            <div className="panel-title">
              <ChevronRight size={18} />
              <h2>Decision Options</h2>
            </div>
            <p className="side-note">Choose only after the Growth Unit has clarified the decision.</p>
          </section>
          <SuggestionCards suggestions={suggestions} onSelect={choose} loading={loading} level={currentLevel} canChoose={Boolean(growthDeck)} />
          <ChatPanel messages={messages} onSend={sendChat} loading={sideLoading} />
        </aside>
      </main>
    </AppShell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
