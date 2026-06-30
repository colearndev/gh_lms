import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  History,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  Sparkles,
  Target,
  Upload,
  X
} from "lucide-react";
import GrowthUnitDeck from "./components/GrowthUnitDeck.jsx";
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

const searchSpaceScale = [
  { label: "All sectors", count: 1200 },
  { label: "Sector fit", count: 520 },
  { label: "Occupation families", count: 220 },
  { label: "Role clusters", count: 90 },
  { label: "Specific paths", count: 35 },
  { label: "Job matches", count: 12 }
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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function optionTitle(item, fallback = "Untitled option") {
  return item?.title || item?.Title || item?.label || item?.Name || item?.name || fallback;
}

function optionCode(item, fallback = "Option") {
  return item?.code || item?.Code || item?.uri || item?.id || item?.competency_id || fallback;
}

function optionKey(item, level = "") {
  return `${level}:${optionCode(item)}:${optionTitle(item)}`;
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

function ProfileInput({ rawProfile, onRawProfile, onApply, onClose, parseError }) {
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onRawProfile(String(reader.result || ""));
    reader.readAsText(file);
  }

  return (
    <div className="modal-backdrop">
      <section className="panel profile-input-modal" role="dialog" aria-modal="true" aria-labelledby="profile-input-title">
        <div className="panel-title modal-title">
          <div>
            <Upload size={18} />
            <h2 id="profile-input-title">Profile Input</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose} aria-label="Close profile input">
            <X size={16} />
          </button>
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
    </div>
  );
}

function ProfileInputLauncher({ onOpen }) {
  return (
    <section className="panel compact-panel">
      <div className="panel-title">
        <Upload size={18} />
        <h2>Profile Input</h2>
      </div>
      <button type="button" className="ghost-button full" onClick={onOpen}>
        <Upload size={16} />
        Open profile JSON
      </button>
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

function canShowCompetencyProfile(level) {
  return level === "job" || level.startsWith("occupation");
}

function SuggestionCards({ suggestions, onSelect, onFocus, onOpenCompetencies, focusedOptionKey, loading, level }) {
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);
  if (loading) return <LoadingState label="Building suggestions from profile and graph options" />;
  if (!suggestions.length) {
    return <div className="empty-state">No AI suggestions generated. Neo4j and Gemini must both be available.</div>;
  }
  return (
    <div className="suggestions">
      <div className="suggestion-tools">
        <button type="button" className="ghost-button" onClick={() => setDescriptionsOpen((value) => !value)}>
          {descriptionsOpen ? <EyeOff size={15} /> : <Eye size={15} />}
          {descriptionsOpen ? "Hide descriptions" : "Show descriptions"}
        </button>
      </div>
      {suggestions.map((item) => {
        const score = item.fitScore ?? item.score ?? item.fit_score ?? "-";
        const title = optionTitle(item);
        const code = optionCode(item);
        const description = item.description || item.Description || item.reason || "No description returned.";
        const reason = item.reason || item.fitReason || item.explanation || "No reason returned.";
        const risk = item.risk || "medium";
        const key = optionKey(item, level);
        const focused = key === focusedOptionKey;
        return (
          <article
            className={`suggestion-card ${focused ? "focused" : ""}`}
            key={key}
            onClick={() => {
              onFocus(key);
              if (canShowCompetencyProfile(level)) onOpenCompetencies(item);
            }}
          >
            <div className="card-heading">
              <div>
                <span className="code">{code}</span>
                <h3>{title}</h3>
              </div>
              <span className="score">{score}</span>
            </div>
            {descriptionsOpen ? <p className="option-description">{description}</p> : null}
            <div className="reason">{reason}</div>
            <div className="card-footer">
              <span className={`risk ${risk}`}>{risk} risk</span>
              {canShowCompetencyProfile(level) ? (
                <button type="button" onClick={(event) => {
                  event.stopPropagation();
                  onFocus(key);
                  onOpenCompetencies(item);
                }}>
                  <BarChart3 size={16} /> Competencies
                </button>
              ) : null}
              <button type="button" onClick={(event) => {
                event.stopPropagation();
                onSelect(item);
              }}>
                Choose <ChevronRight size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CompetencyProfileModal({
  node,
  profile,
  loading,
  error,
  competencyLevel,
  onCompetencyLevel,
  lessonLength,
  onLessonLength,
  onGenerateGrowthUnit,
  growthUnitLoading,
  onClose
}) {
  const [activeTab, setActiveTab] = useState("chart");
  const nodeTitle = optionTitle(node, "Selected node");
  const escoRows = profile?.competencies || [];
  const ghRows = profile?.ghCompetencies || profile?.gh_competencies || [];
  const jobs = profile?.jobs || [];

  return (
    <div className="modal-backdrop">
      <section className="panel competency-modal" role="dialog" aria-modal="true" aria-labelledby="competency-modal-title">
        <div className="panel-title modal-title">
          <div>
            <BarChart3 size={18} />
            <div>
              <span className="brand-kicker">Weighted competency profile</span>
              <h2 id="competency-modal-title">{nodeTitle}</h2>
            </div>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose} aria-label="Close competency profile">
            <X size={16} />
          </button>
        </div>

        {loading ? <LoadingState label="Tracing downstream jobs and weighting competencies" /> : null}
        {error ? <ErrorPanel message={error} /> : null}

        {!loading && !error && profile ? (
          <>
            <div className="competency-metrics">
              <Signal label="Downstream jobs" value={jobs.length} />
              <Signal label="ESCO competencies" value={escoRows.length} />
              <Signal label="GH competencies" value={ghRows.length} />
            </div>
            <div className="competency-growth-controls">
              <label htmlFor="competency-level">Current level</label>
              <select id="competency-level" value={competencyLevel} onChange={(event) => onCompetencyLevel(Number(event.target.value))}>
                <option value={1}>1 - novice</option>
                <option value={2}>2 - basic</option>
                <option value={3}>3 - working</option>
                <option value={4}>4 - advanced</option>
                <option value={5}>5 - expert</option>
              </select>
              <label htmlFor="competency-lesson-length">Lesson length</label>
              <select id="competency-lesson-length" value={lessonLength} onChange={(event) => onLessonLength(event.target.value)}>
                <option value="<2min">&lt;2min</option>
                <option value="2-5min">2-5min</option>
                <option value="5-10min">5-10min</option>
                <option value="10-20min">10-20min</option>
                <option value=">20min">&gt;20min</option>
              </select>
            </div>
            <div className="unit-tabs competency-tabs">
              <button type="button" className={activeTab === "chart" ? "active" : ""} onClick={() => setActiveTab("chart")}>
                Weighted view
              </button>
              <button type="button" className={activeTab === "data" ? "active" : ""} onClick={() => setActiveTab("data")}>
                Data
              </button>
            </div>
            {activeTab === "chart" ? (
              <div className="competency-chart-grid">
                <CompetencyRankedBars title="ESCO competencies" rows={escoRows} tone="esco" onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} />
                <CompetencyRankedBars title="GH competencies" rows={ghRows} tone="gh" onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} />
              </div>
            ) : (
              <div className="competency-table-grid">
                <CompetencyDataTable title="ESCO" rows={escoRows} onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} />
                <CompetencyDataTable title="GH" rows={ghRows} onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} />
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function isKnowledgeRow(row) {
  return /knowledge/i.test(firstNonEmpty(row?.type, row?.Type, row?.category, row?.Category));
}

function CompetencyGrowthButton({ row, onGenerateGrowthUnit, growthUnitLoading }) {
  if (!isKnowledgeRow(row)) return null;
  return (
    <button type="button" className="ghost-button competency-growth-button" onClick={() => onGenerateGrowthUnit(row)} disabled={growthUnitLoading}>
      {growthUnitLoading ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
      Generate Growth Unit
    </button>
  );
}

function CompetencyRankedBars({ title, rows, tone, onGenerateGrowthUnit, growthUnitLoading }) {
  const topRows = rows.slice(0, 20);
  const maxScore = Math.max(1, ...topRows.map((row) => Number(row.score || 0)));
  return (
    <section className="competency-panel">
      <h3>{title}</h3>
      {topRows.length ? topRows.map((row) => {
        const label = optionTitle(row, "Untitled competency");
        const score = Number(row.score || 0);
        const width = `${Math.max(4, Math.round((score / maxScore) * 100))}%`;
        return (
          <article className="competency-bar-row" key={row.uri || row.Code || label}>
            <div className="competency-bar-heading">
              <strong>{label}</strong>
              <span>{score}</span>
            </div>
            <div className={`competency-bar ${tone}`}>
              <span style={{ width }} />
            </div>
            <p>{firstNonEmpty(row.Type, row.type, "Competency")} · {row.essential_hits || row.essentialHits || 0} essential · {row.optional_hits || row.optionalHits || 0} optional · {row.job_count || row.jobCount || 0} jobs</p>
            <CompetencyGrowthButton row={row} onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} />
          </article>
        );
      }) : <div className="empty-state small">No downstream competencies found.</div>}
    </section>
  );
}

function CompetencyDataTable({ title, rows, onGenerateGrowthUnit, growthUnitLoading }) {
  return (
    <section className="competency-panel">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="competency-table">
          <div className="competency-table-head">
            <span>Score</span>
            <span>Competency</span>
            <span>Hits</span>
            <span>Sources</span>
            <span>Growth</span>
          </div>
          {rows.slice(0, 100).map((row) => {
            const label = optionTitle(row, "Untitled competency");
            return (
              <div className="competency-table-row" key={row.uri || row.Code || label}>
                <strong>{row.score}</strong>
                <span>{label}</span>
                <span>{row.essential_hits || row.essentialHits || 0}E / {row.optional_hits || row.optionalHits || 0}O</span>
                <span>{(row.sources || []).join(" | ") || "-"}</span>
                <span><CompetencyGrowthButton row={row} onGenerateGrowthUnit={onGenerateGrowthUnit} growthUnitLoading={growthUnitLoading} /></span>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-state small">No downstream competencies found.</div>}
    </section>
  );
}

function Graph3D({ currentLevel, history, suggestions, focusedOptionKey, onFocusOption }) {
  const mountRef = useRef(null);
  const [hidden, setHidden] = useState(false);
  const currentIndex = Math.max(0, levels.findIndex((level) => level.id === currentLevel));
  const activeScale = searchSpaceScale[currentIndex] || searchSpaceScale[0];
  const nextScale = searchSpaceScale[Math.min(currentIndex + 1, searchSpaceScale.length - 1)] || activeScale;
  const narrowedPercent = Math.round((1 - activeScale.count / searchSpaceScale[0].count) * 100);
  const recommended = suggestions[0] || null;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || hidden) return undefined;
    const width = mount.clientWidth || 760;
    const height = mount.clientHeight || 420;
    mount.innerHTML = "";

    let renderer;
    let frame;
    let controls;
    let resizeObserver;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clickableNodes = [];
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf7fafa);
      scene.fog = new THREE.FogExp2(0xf7fafa, 0.036);

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.set(0.8, 7.2, 12.5);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      mount.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.minDistance = 4.2;
      controls.maxDistance = 22;
      controls.target.set(0, 0, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 0.72));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.88);
      keyLight.position.set(5, 8, 6);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xcfe8e4, 0.36);
      fillLight.position.set(-5, 3, -6);
      scene.add(fillLight);

      const crispPathMaterial = new THREE.LineBasicMaterial({ color: 0x1f6f67, transparent: true, opacity: 0.96 });
      const suggestedPathMaterial = new THREE.LineBasicMaterial({ color: 0xd39d45, transparent: true, opacity: 0.96 });
      const fadedLineMaterial = new THREE.LineBasicMaterial({ color: 0x8aa0a5, transparent: true, opacity: 0.16 });
      const chosenMaterial = new THREE.MeshStandardMaterial({ color: 0x1f6f67, roughness: 0.34, metalness: 0.05 });
      const activeMaterial = new THREE.MeshStandardMaterial({ color: 0xd39d45, roughness: 0.3, metalness: 0.08 });
      const suggestedMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c66d, emissive: 0x5b3b07, emissiveIntensity: 0.18, roughness: 0.28 });
      const optionMaterial = new THREE.MeshStandardMaterial({ color: 0x4f8f97, emissive: 0x163235, emissiveIntensity: 0.08, roughness: 0.36 });
      const focusedMaterial = new THREE.MeshStandardMaterial({ color: 0xf6a63f, emissive: 0x8c4b07, emissiveIntensity: 0.34, roughness: 0.24 });
      const fadedMaterial = new THREE.MeshStandardMaterial({ color: 0x9fb4b8, transparent: true, opacity: 0.22, roughness: 0.7 });
      const cloudMaterial = new THREE.PointsMaterial({ color: 0x7f969b, transparent: true, opacity: 0.16, size: 0.07, depthWrite: false });
      const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xd39d45, transparent: true, opacity: 0.1, depthWrite: false });
      const optionHaloMaterial = new THREE.MeshBasicMaterial({ color: 0x4f8f97, transparent: true, opacity: 0.08, depthWrite: false });
      const focusHaloMaterial = new THREE.MeshBasicMaterial({ color: 0xf6a63f, transparent: true, opacity: 0.18, depthWrite: false });

      function wrapLabelText(ctx, text, maxWidth, maxLines) {
        const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
        const lines = [];
        let line = "";
        words.forEach((word) => {
          const candidate = line ? `${line} ${word}` : word;
          if (ctx.measureText(candidate).width <= maxWidth || !line) {
            line = candidate;
          } else {
            lines.push(line);
            line = word;
          }
        });
        if (line) lines.push(line);
        return lines.slice(0, maxLines);
      }

      function makeLabel(text, color = "#25373a", options = {}) {
        const canvas = document.createElement("canvas");
        const fontSize = options.fontSize || 30;
        const maxLines = options.maxLines || 3;
        const lineHeight = fontSize * 1.2;
        const horizontalPadding = 34;
        const verticalPadding = 26;
        canvas.width = options.width || 640;
        canvas.height = Math.ceil(verticalPadding * 2 + lineHeight * maxLines);
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = wrapLabelText(ctx, text, canvas.width - horizontalPadding * 2, maxLines);
        const usedLines = lines.length || 1;
        const firstY = canvas.height / 2 - ((usedLines - 1) * lineHeight) / 2;
        (lines.length ? lines : [String(text || "")]).forEach((line, index) => {
          ctx.fillText(line, canvas.width / 2, firstY + index * lineHeight);
        });
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        const scale = options.scale || 1;
        sprite.scale.set(scale * 2.6, scale * (0.42 + usedLines * 0.24), 1);
        return sprite;
      }

      const graphGroup = new THREE.Group();
      scene.add(graphGroup);

      const coreNodes = levels.map((level, index) => {
        const chosen = history.find((item) => item.level === level.id);
        const isActive = level.id === currentLevel;
        const isPast = index < currentIndex;
        const orbitRadius = 0.75 + index * 0.92;
        const angle = -0.9 + index * 0.82;
        const position = new THREE.Vector3(
          Math.cos(angle) * orbitRadius * 1.35,
          (index - currentIndex) * 0.16,
          Math.sin(angle) * orbitRadius
        );
        return { level, index, chosen, isActive, isPast, position };
      });

      const cloudPositions = [];
      levels.forEach((level, stageIndex) => {
        const center = coreNodes[stageIndex].position;
        const density = Math.max(18, Math.floor((searchSpaceScale[stageIndex]?.count || 80) / 5));
        for (let i = 0; i < Math.min(220, density); i += 1) {
          const angle = i * 2.399 + stageIndex * 0.7;
          const ring = 0.72 + ((i * 37) % 170) / 48;
          cloudPositions.push(
            center.x + Math.cos(angle) * ring,
            center.y - 1.1 + (((i * 17) % 100) / 100) * 2.3,
            center.z + Math.sin(angle) * ring * 0.9
          );
        }
      });
      const cloudGeometry = new THREE.BufferGeometry();
      cloudGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cloudPositions, 3));
      graphGroup.add(new THREE.Points(cloudGeometry, cloudMaterial));

      coreNodes.forEach((node, index) => {
        const isCrisp = node.chosen || node.isActive || node.isPast;
        const material = node.isActive ? activeMaterial : isCrisp ? chosenMaterial : fadedMaterial;
        const radius = node.isActive ? 0.22 : isCrisp ? 0.18 : 0.14;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), material);
        mesh.position.copy(node.position);
        graphGroup.add(mesh);

        if (node.isActive) {
          const halo = new THREE.Mesh(new THREE.SphereGeometry(0.56, 32, 18), haloMaterial);
          halo.position.copy(node.position);
          graphGroup.add(halo);
        }

        const label = makeLabel(optionTitle(node.chosen, node.level.label), node.isActive ? "#8b5f13" : isCrisp ? "#1f5c56" : "#7f9296", { maxLines: 2, scale: node.isActive ? 0.9 : 0.78 });
        label.position.copy(node.position).add(new THREE.Vector3(0, node.isActive ? 0.78 : 0.66, 0));
        graphGroup.add(label);

        if (index > 0) {
          const prev = coreNodes[index - 1];
          const lineGeometry = new THREE.BufferGeometry().setFromPoints([prev.position, node.position]);
          graphGroup.add(new THREE.Line(lineGeometry, index <= currentIndex ? crispPathMaterial : fadedLineMaterial));
        }
      });

      const activeNode = coreNodes[currentIndex] || coreNodes[0];
      const optionCount = Math.max(0, suggestions.length);
      suggestions.forEach((suggestion, index) => {
        const key = optionKey(suggestion, currentLevel);
        const isRecommended = index === 0;
        const isFocused = key === focusedOptionKey;
        const angle = index * 2.399 + currentIndex * 0.42;
        const orbit = 1.18 + Math.sqrt(index + 1) * 0.56;
        const vertical = Math.sin(index * 1.37) * 0.68 - 0.18;
        const pos = activeNode.position.clone().add(new THREE.Vector3(
          Math.cos(angle) * orbit,
          vertical,
          Math.sin(angle) * orbit * 0.86
        ));
        const material = isFocused ? focusedMaterial : isRecommended ? suggestedMaterial : optionMaterial;
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(isFocused ? 0.22 : isRecommended ? 0.18 : 0.15, 28, 16), material);
        sphere.position.copy(pos);
        sphere.userData.optionKey = key;
        sphere.userData.optionIndex = index;
        graphGroup.add(sphere);
        clickableNodes.push(sphere);

        const halo = new THREE.Mesh(new THREE.SphereGeometry(isFocused ? 0.62 : 0.42, 28, 16), isFocused ? focusHaloMaterial : optionHaloMaterial);
        halo.position.copy(pos);
        graphGroup.add(halo);

        const lineOpacity = isFocused ? 0.95 : isRecommended ? 0.78 : 0.46;
        const lineColor = isFocused ? 0xf6a63f : isRecommended ? 0xd39d45 : 0x4f8f97;
        const optionLineMaterial = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: lineOpacity });
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([activeNode.position, pos]);
        graphGroup.add(new THREE.Line(lineGeometry, optionLineMaterial));

        if (isFocused || isRecommended || index < 6 || optionCount <= 8) {
          const color = isFocused ? "#8c4b07" : isRecommended ? "#8b5f13" : "#2f6167";
          const label = makeLabel(optionTitle(suggestion, `Option ${index + 1}`), color, {
            fontSize: isFocused ? 32 : 28,
            maxLines: isFocused ? 4 : 3,
            scale: isFocused ? 1.05 : 0.82
          });
          label.position.copy(pos).add(new THREE.Vector3(0, isFocused ? 1.02 : 0.78, 0));
          graphGroup.add(label);
        }
      });

      for (let i = 0; i < 36; i += 1) {
        const stage = coreNodes[(i + currentIndex) % coreNodes.length];
        const angle = i * 1.618;
        const distance = 2.2 + (i % 7) * 0.44;
        const pos = stage.position.clone().add(new THREE.Vector3(
          Math.cos(angle) * distance,
          Math.sin(i * 0.9) * 0.9,
          Math.sin(angle) * distance
        ));
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.065 + (i % 3) * 0.012, 12, 8), fadedMaterial);
        sphere.position.copy(pos);
        graphGroup.add(sphere);
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([stage.position, pos]);
        graphGroup.add(new THREE.Line(lineGeometry, fadedLineMaterial));
      }

      controls.target.copy(activeNode.position);
      camera.position.set(activeNode.position.x + 1.3, 5.2, 9.2);

      function handleClick(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const [hit] = raycaster.intersectObjects(clickableNodes, false);
        if (hit?.object?.userData?.optionKey) {
          onFocusOption(hit.object.userData.optionKey);
        }
      }

      renderer.domElement.addEventListener("click", handleClick);

      resizeObserver = new ResizeObserver(() => {
        const nextWidth = mount.clientWidth || width;
        const nextHeight = mount.clientHeight || height;
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(nextWidth, nextHeight);
      });
      resizeObserver.observe(mount);

      function animate() {
        frame = requestAnimationFrame(animate);
        controls.update();
        const zoomDistance = camera.position.distanceTo(controls.target);
        cloudMaterial.opacity = THREE.MathUtils.clamp((zoomDistance - 5) / 30, 0.04, 0.18);
        graphGroup.rotation.y = Math.sin(Date.now() * 0.00018) * 0.025;
        renderer.render(scene, camera);
      }
      animate();

      return () => {
        cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        renderer.domElement.removeEventListener("click", handleClick);
        controls?.dispose();
        renderer.dispose();
        mount.innerHTML = "";
      };
    } catch (error) {
      drawCareerGraphFallback(mount, width, height, currentIndex, suggestions);
      return () => {
        mount.innerHTML = "";
      };
    }
  }, [currentLevel, currentIndex, focusedOptionKey, hidden, history, onFocusOption, recommended, suggestions]);

  if (hidden) {
    return (
      <section className="graph-3d-panel graph-3d-panel-collapsed">
        <div className="panel-title graph-panel-title">
          <div>
            <Database size={18} />
            <h2>3D Competency Graph</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={() => setHidden(false)} aria-label="Show graph visualization">
            <Eye size={16} />
            Show
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="graph-3d-panel search-map-panel">
      <div className="panel-title graph-panel-title">
        <div>
          <Database size={18} />
          <h2>3D Competency Graph</h2>
        </div>
        <button type="button" className="ghost-button icon-button" onClick={() => setHidden(true)} aria-label="Hide graph visualization">
          <EyeOff size={16} />
          Hide
        </button>
      </div>
      <div className="search-map">
        <div className="career-graph-canvas" ref={mountRef} />
        <div className="graph-viz-overlay">Click option nodes · drag to orbit · scroll to zoom</div>
        <div className="search-flow">
          {levels.map((level, index) => {
            const chosen = history.find((item) => item.level === level.id);
            const active = level.id === currentLevel;
            const reached = Boolean(chosen) || index <= currentIndex;
            return (
              <div className={`search-step ${active ? "active" : ""} ${chosen ? "chosen" : ""} ${reached ? "reached" : ""}`} key={level.id}>
                <span className="step-count">{searchSpaceScale[index]?.count || "?"}</span>
                <strong>{level.label}</strong>
                <p>{chosen?.title || (active ? "choosing now" : index < currentIndex ? "passed" : "ahead")}</p>
              </div>
            );
          })}
        </div>
        <div className="search-direction">
          <div>
            <span className="brand-kicker">Started from</span>
            <strong>Broad career graph</strong>
            <p>{searchSpaceScale[0].count}+ possible directions</p>
          </div>
          <ChevronRight size={22} />
          <div>
            <span className="brand-kicker">Moving toward</span>
            <strong>{levels[currentIndex]?.label || "Job"} fit</strong>
            <p>{suggestions.length || nextScale.count} visible next choices</p>
          </div>
        </div>
      </div>
      <div className="narrowing-strip">
        <div>
          <span className="brand-kicker">Search space narrowed</span>
          <strong>{Math.max(0, narrowedPercent)}%</strong>
        </div>
        <div className="narrowing-bar" aria-label={`Search space narrowed ${Math.max(0, narrowedPercent)} percent`}>
          <span style={{ width: `${Math.max(8, narrowedPercent)}%` }} />
        </div>
        <p>{activeScale.count} approximate directions remain at this stage; the blurred field shows the wider opportunity space still behind the shortlist.</p>
      </div>
      <div className="graph-legend">
        <span><i className="chosen-dot" /> chosen path</span>
        <span><i className="active-dot" /> current stage</span>
        <span><i className="suggested-dot" /> suggested next path</span>
        <span><i className="option-dot" /> faded graph context</span>
      </div>
    </section>
  );
}

function drawCareerGraphFallback(mount, width, height, currentIndex, suggestions) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  mount.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7fafa";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 120; i += 1) {
    const x = 24 + ((i * 47) % Math.max(1, width - 48));
    const y = 24 + ((i * 83) % Math.max(1, height - 80));
    ctx.fillStyle = "rgba(111, 135, 144, 0.18)";
    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  const stepWidth = width / (levels.length + 1);
  const centerY = height * 0.48;
  const points = levels.map((level, index) => ({
    x: stepWidth * (index + 1),
    y: centerY,
    radius: 34 - index * 4
  }));

  points.forEach((point, index) => {
    if (index > 0) {
      ctx.strokeStyle = index <= currentIndex ? "#1f6f67" : "rgba(120, 145, 150, 0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(points[index - 1].x, points[index - 1].y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  });

  points.forEach((point, index) => {
    ctx.fillStyle = index === currentIndex ? "#d39d45" : index < currentIndex ? "#1f6f67" : "rgba(159, 183, 187, 0.65)";
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, point.radius, Math.max(10, point.radius * 0.38), 0, 0, Math.PI * 2);
    ctx.fill();
    const shouldLabel = width >= 560 || index === 0 || index === currentIndex || index === levels.length - 1;
    if (shouldLabel) {
      ctx.fillStyle = "#223033";
      ctx.font = width >= 560 ? "12px sans-serif" : "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(levels[index].label, point.x, point.y + 42);
    }
  });

  const activePoint = points[currentIndex] || points[0];
  const visibleOptions = Math.max(3, Math.min(5, suggestions.length || 5));
  for (let index = 0; index < visibleOptions; index += 1) {
    const x = activePoint.x + (index - 2) * 28;
    const y = activePoint.y + 72 + Math.abs(index - 2) * 5;
    ctx.strokeStyle = "rgba(211, 157, 69, 0.75)";
    ctx.beginPath();
    ctx.moveTo(activePoint.x, activePoint.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = "#6f8790";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const [focusedOptionKey, setFocusedOptionKey] = useState("");
  const [growthDeck, setGrowthDeck] = useState(null);
  const [selectedGrowthUnitId, setSelectedGrowthUnitId] = useState(null);
  const [lessonLength, setLessonLength] = useState("5-10min");
  const [profileInputOpen, setProfileInputOpen] = useState(false);
  const [competencyNode, setCompetencyNode] = useState(null);
  const [competencyProfile, setCompetencyProfile] = useState(null);
  const [competencyLoading, setCompetencyLoading] = useState(false);
  const [competencyError, setCompetencyError] = useState("");
  const [competencyLevel, setCompetencyLevel] = useState(1);
  const [competencyGrowthLoading, setCompetencyGrowthLoading] = useState(false);
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
      setFocusedOptionKey("");
      setCurrentLevel("sector");
      setProfileInputOpen(false);
    } catch (err) {
      setParseError(err.message);
    }
  }

  async function loadLevel(level) {
    setLoading(true);
    setError("");
    setFocusedOptionKey("");
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
      const nextSuggestions = ranked.suggestions || [];
      setSuggestions(nextSuggestions);
      setFocusedOptionKey(nextSuggestions[0] ? optionKey(nextSuggestions[0], level) : "");
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
    setFocusedOptionKey("");
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
        body: JSON.stringify({ level: currentLevel, profile, options: suggestions, selectedPath: history, LENGTH: lessonLength })
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

  async function openCompetencyProfile(item) {
    setCompetencyNode(item);
    setCompetencyProfile(null);
    setCompetencyError("");
    setCompetencyLevel(1);
    setCompetencyGrowthLoading(false);
    setCompetencyLoading(true);
    try {
      const profile = await api("/api/neo4j/competency-profile", {
        method: "POST",
        body: JSON.stringify({
          uri: item.uri,
          code: item.code || item.Code,
          limit: 100,
          essentialWeight: 2,
          optionalWeight: 1
        })
      });
      setCompetencyProfile(profile);
    } catch (err) {
      setCompetencyError(err.message);
    } finally {
      setCompetencyLoading(false);
    }
  }

  function closeCompetencyProfile() {
    setCompetencyNode(null);
    setCompetencyProfile(null);
    setCompetencyError("");
    setCompetencyLoading(false);
    setCompetencyGrowthLoading(false);
  }

  async function generateCompetencyGrowthUnit(competency, highlightedNode) {
    const node = highlightedNode || competencyProfile?.node || competencyNode;
    setCompetencyGrowthLoading(true);
    try {
      const deck = await api("/api/gemini/competency-growth-unit", {
        method: "POST",
        body: JSON.stringify({
          highlightedNode: node,
          selectedCompetency: competency,
          user_competency_level_1_to_5: competencyLevel,
          LENGTH: lessonLength,
          profile
        })
      });
      setGrowthDeck(deck);
      setSelectedGrowthUnitId(deck.growth_units?.[0]?.growth_unit_id || null);
      if (competencyNode) closeCompetencyProfile();
    } catch (err) {
      setCompetencyError(err.message);
    } finally {
      setCompetencyGrowthLoading(false);
    }
  }

  async function regenerateGrowthUnit() {
    if (growthDeck?.deck_type === "competency_growth_unit") {
      await generateCompetencyGrowthUnit(growthDeck.selected_competency, growthDeck.highlighted_node);
      return;
    }
    await generateGrowthUnit();
  }

  function resetPath() {
    setHistory([]);
    setCurrentLevel("sector");
    setFocusedOptionKey("");
    setGrowthDeck(null);
    setSelectedGrowthUnitId(null);
  }

  return (
    <AppShell>
      <Neo4jStatus status={status} />
      <ServiceWarning status={status} />
      <main className="workspace">
        <aside className="left-column">
          <ChatPanel messages={messages} onSend={sendChat} loading={sideLoading} />
          <DecisionHistory history={history} onReset={resetPath} />
          <ProfileSummary profile={profile} />
          <ProfileInputLauncher onOpen={() => setProfileInputOpen(true)} />
        </aside>
        <section className="center-column">
          <Graph3D currentLevel={currentLevel} history={history} suggestions={suggestions} focusedOptionKey={focusedOptionKey} onFocusOption={setFocusedOptionKey} />
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
          <GrowthUnitDeck
            deck={growthDeck}
            selectedUnitId={selectedGrowthUnitId}
            onSelectUnit={setSelectedGrowthUnitId}
            onGenerate={regenerateGrowthUnit}
            loading={sideLoading || competencyGrowthLoading}
            disabled={growthDeck?.deck_type === "competency_growth_unit" ? false : !suggestions.length}
            lessonLength={lessonLength}
            onLessonLength={setLessonLength}
          />
        </section>
        <aside className="right-column">
          <section className="panel">
            <div className="panel-title">
              <ChevronRight size={18} />
              <h2>Decision Options</h2>
            </div>
            <p className="side-note">Choose an option directly, or generate a Growth Unit first for extra context.</p>
          </section>
          <SuggestionCards suggestions={suggestions} onSelect={choose} onFocus={setFocusedOptionKey} onOpenCompetencies={openCompetencyProfile} focusedOptionKey={focusedOptionKey} loading={loading} level={currentLevel} />
        </aside>
      </main>
      {profileInputOpen ? (
        <ProfileInput
          rawProfile={rawProfile}
          onRawProfile={setRawProfile}
          onApply={applyProfile}
          onClose={() => setProfileInputOpen(false)}
          parseError={parseError}
        />
      ) : null}
      {competencyNode ? (
        <CompetencyProfileModal
          node={competencyProfile?.node || competencyNode}
          profile={competencyProfile}
          loading={competencyLoading}
          error={competencyError}
          competencyLevel={competencyLevel}
          onCompetencyLevel={setCompetencyLevel}
          lessonLength={lessonLength}
          onLessonLength={setLessonLength}
          onGenerateGrowthUnit={generateCompetencyGrowthUnit}
          growthUnitLoading={competencyGrowthLoading}
          onClose={closeCompetencyProfile}
        />
      ) : null}
    </AppShell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
