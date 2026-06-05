const express = require("express");
const fs = require("fs");
const https = require("https");
const path = require("path");
const neo4j = require("neo4j-driver");

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    const equals = trimmed.indexOf("=");
    if (equals === -1) return;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadDotEnv();

const app = express();
const port = process.env.PORT || 8787;
const preferredGeminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

app.use(express.json({ limit: "4mb" }));

const neo4jReady = Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
const geminiReady = Boolean(process.env.GEMINI_API_KEY);

const driver = neo4jReady
  ? neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
  : null;

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode || 503;
  return error;
}

function requireNeo4j() {
  if (!neo4jReady || !driver) {
    throw serviceError("Neo4j is not available. Configure NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD, then restart the app.");
  }
}

function requireGemini() {
  if (!geminiReady) {
    throw serviceError("Gemini AI is not available. Configure GEMINI_API_KEY, then restart the app.");
  }
}

function toPlain(record) {
  const object = {};
  for (const key of record.keys) {
    const value = record.get(key);
    object[key] = neo4j.isInt(value) ? value.toNumber() : value;
  }
  return normalizeGraphOption(object);
}

function normalizeGraphOption(option) {
  if (!option) return {};
  const code = firstText(option.code, option.Code, option.id, option.ID, option.uri);
  const title = firstText(
    option.title,
    option.Title,
    option.name,
    option.Name,
    option.label,
    option.Label,
    option.titleHu,
    option.Title_HU,
    option.TitleHu,
    code
  );
  return Object.assign({}, option, {
    code,
    uri: firstText(option.uri, option.URI),
    level: firstText(option.level, option.Level),
    title,
    titleHu: firstText(option.titleHu, option.Title_HU, option.TitleHu, option.Title, title),
    description: firstText(option.description, option.Description, option.descriptionHu, option.Description_HU, "")
  });
}

function firstText() {
  for (var i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

async function readQuery(query, params) {
  requireNeo4j();
  params = params || {};
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.readTransaction(function (tx) {
      return tx.run(query, params);
    });
    return result.records.map(toPlain);
  } finally {
    await session.close();
  }
}

async function getSectors() {
  const rows = await readQuery(`
    MATCH (s:Sector)
    RETURN s.Code AS code,
           coalesce(s.Title, s.Title_HU, s.Code) AS title,
           coalesce(s.Title_HU, s.Title, s.Code) AS titleHu,
           coalesce(s.Description, s.Description_HU, "") AS description,
           coalesce(s.Description_HU, s.Description, "") AS descriptionHu
    ORDER BY title
    LIMIT 200
  `);
  return rows;
}

async function getOccupationsBySector(sectorCode, level) {
  const rows = await readQuery(`
    MATCH (s:Sector)<-[:RelatedSector]-(n)
    WHERE s.Code = $sectorCode AND (n:Occupation OR n:Job)
    MATCH (n)-[:HasParentOccupation*0..7]->(o:Occupation)
    WHERE toString(o.Level) = toString($level)
    RETURN DISTINCT o.uri AS uri, o.Code AS code, o.Level AS level,
           coalesce(o.Title, o.Title_HU, o.Code) AS title,
           coalesce(o.Title_HU, o.Title, o.Code) AS titleHu,
           coalesce(o.Description, o.Description_HU, "") AS description
    ORDER BY code, title
    LIMIT 100
  `, { sectorCode, level: String(level) });

  return rows;
}

async function getChildOccupations(parentCode) {
  const rows = await readQuery(`
    MATCH (child:Occupation)-[:HasParentOccupation]->(parent:Occupation)
    WHERE parent.Code = $parentCode
    RETURN child.uri AS uri, child.Code AS code, child.Level AS level,
           coalesce(child.Title, child.Title_HU, child.Code) AS title,
           coalesce(child.Title_HU, child.Title, child.Code) AS titleHu,
           coalesce(child.Description, child.Description_HU, "") AS description
    ORDER BY code, title
    LIMIT 100
  `, { parentCode });
  return rows;
}

async function getJobsUnderOccupation(occupationCode) {
  const rows = await readQuery(`
    MATCH (j:Job)-[:HasParentOccupation]->(o:Occupation)
    WHERE o.Code = $occupationCode
    RETURN j.uri AS uri, j.Code AS code, j.Level AS level,
           coalesce(j.Title, j.Title_HU, j.Code) AS title,
           coalesce(j.Title_HU, j.Title, j.Code) AS titleHu,
           coalesce(j.Description, j.Description_HU, "") AS description
    ORDER BY code, title
    LIMIT 100
  `, { occupationCode });
  return rows;
}

async function getChildJobs(parentCode) {
  const rows = await readQuery(`
    MATCH (child:Job)-[:HasParentOccupation]->(parent:Job)
    WHERE parent.Code = $parentCode
    RETURN child.uri AS uri, child.Code AS code, child.Level AS level,
           coalesce(child.Title, child.Title_HU, child.Code) AS title,
           coalesce(child.Title_HU, child.Title, child.Code) AS titleHu,
           coalesce(child.Description, child.Description_HU, "") AS description
    ORDER BY code, title
    LIMIT 100
  `, { parentCode });
  return rows;
}

async function getCompetenciesForJob(jobCode) {
  const rows = await readQuery(`
    MATCH (j:Job)-[:GH_RequiresCompetency]->(gh:GH_Competency)
    WHERE j.Code = $jobCode
    RETURN gh.uri AS uri, gh.Code AS code,
           coalesce(gh.Title, gh.Title_HU, gh.Code) AS title,
           coalesce(gh.Title_HU, gh.Title, gh.Code) AS titleHu,
           coalesce(gh.Description, gh.Description_HU, "") AS description,
           coalesce(gh.Description_HU, gh.Description, "") AS descriptionHu,
           gh.Type AS type, gh.Level AS level
    ORDER BY type, level, code
    LIMIT 50
  `, { jobCode });
  return rows;
}

async function getSectorsForNode(code) {
  const rows = await readQuery(`
    MATCH (n)-[:RelatedSector]->(s:Sector)
    WHERE n.Code = $code
    RETURN s.Code AS code,
           coalesce(s.Title, s.Title_HU, s.Code) AS title,
           coalesce(s.Title_HU, s.Title, s.Code) AS titleHu
    ORDER BY title
    LIMIT 20
  `, { code });
  return rows;
}

function profileSignal(profile) {
  const p = (profile && profile.user_profile_analysis) || profile || {};
  const categories = p.categories || {};
  const personal = p.personal_profile || categories.personal_profile || {};
  const professional = p.professional_profile || categories.professional_profile || {};
  const self = p.self_awareness || categories.self_awareness || {};
  const cv = professional.cv || {};
  const competencyMap = personal.competency_map_pcpv || {};
  return {
    goals: personal.personal_goals || {},
    competencies: competencyMap.competencies || [],
    workExperience: cv.work_experience || [],
    education: cv.education || [],
    workValues: professional.work_values || [],
    motivation: self.personal_motivation_pcpv || {},
    burnout: self.burnout_index_pcpv || {},
    learningAgility: self.learning_agility_onboarding || self.learning_agility_pcpv_medium || {},
    careerAwareness: self.career_awareness || {}
  };
}

function extractJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

async function askGemini(prompt, fallback) {
  requireGemini();
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  });

  const models = await getGeminiModelCandidates();
  var lastError = null;
  for (var i = 0; i < models.length; i += 1) {
    try {
      const text = await postGeminiGenerateContent(models[i], body);
      const parsed = JSON.parse(text);
      const candidate = parsed.candidates && parsed.candidates[0];
      const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
      return extractJson((part && part.text) || "", fallback);
    } catch (error) {
      lastError = error;
      if (error.statusCode !== 404) throw error;
    }
  }
  throw lastError || new Error("Gemini request failed");
}

async function getGeminiModelCandidates() {
  const builtIns = [
    preferredGeminiModel,
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash"
  ].filter(function (model, index, list) {
    return model && list.indexOf(model) === index;
  });

  try {
    const text = await new Promise(function (resolve, reject) {
      const req = https.request({
        hostname: "generativelanguage.googleapis.com",
        path: "/v1beta/models?key=" + encodeURIComponent(process.env.GEMINI_API_KEY),
        method: "GET"
      }, function (res) {
        var chunks = "";
        res.on("data", function (chunk) { chunks += chunk; });
        res.on("end", function () {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error("Gemini model list failed with status " + res.statusCode));
            return;
          }
          resolve(chunks);
        });
      });
      req.on("error", reject);
      req.end();
    });
    const parsed = JSON.parse(text);
    const listed = (parsed.models || [])
      .filter(function (model) {
        return (model.supportedGenerationMethods || []).indexOf("generateContent") !== -1;
      })
      .map(function (model) {
        return String(model.name || "").replace(/^models\//, "");
      })
      .filter(Boolean);

    return builtIns.concat(listed).filter(function (model, index, list) {
      return list.indexOf(model) === index;
    });
  } catch (_error) {
    return builtIns;
  }
}

async function checkGeminiAvailable() {
  if (!geminiReady) return false;
  try {
    await new Promise(function (resolve, reject) {
      const req = https.request({
        hostname: "generativelanguage.googleapis.com",
        path: "/v1beta/models?key=" + encodeURIComponent(process.env.GEMINI_API_KEY),
        method: "GET"
      }, function (res) {
        res.resume();
        res.on("end", function () {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error("Gemini status check failed with status " + res.statusCode));
        });
      });
      req.on("error", reject);
      req.end();
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function postGeminiGenerateContent(model, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: "/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(process.env.GEMINI_API_KEY),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, function (res) {
      var chunks = "";
      res.on("data", function (chunk) { chunks += chunk; });
      res.on("end", function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error("Gemini request failed with status " + res.statusCode + " for model " + model);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }
        resolve(chunks);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function suggest(level, options, profile, context = {}) {
  if (!options || !options.length) {
    throw serviceError("Neo4j returned no graph options for this decision level. No AI suggestions were generated.", 422);
  }
  const fallback = null;
  const prompt = `
You are a GapHopper career coach. Return JSON only with {"suggestions": []}.
Rank 3-5 options for decision level ${level}. Be supportive, concise, and do not diagnose stress or burnout.
Each suggestion must include code, title, description, reason, fitScore 0-100, risk lower|medium|higher, and nextQuestion.
Copy code, title, and description exactly from one of the provided options. Do not invent option names.
Profile signal: ${JSON.stringify(profileSignal(profile))}
Context: ${JSON.stringify(context)}
Options: ${JSON.stringify(options.map(normalizeGraphOption).slice(0, 30))}
`;
  const result = await askGemini(prompt, fallback);
  if (!result || !Array.isArray(result.suggestions) || !result.suggestions.length) {
    throw serviceError("Gemini did not return any suggestions. Nothing was generated.", 502);
  }
  return { suggestions: normalizeSuggestions(result.suggestions, options) };
}

function normalizeSuggestions(suggestions, options) {
  const normalizedOptions = options.map(normalizeGraphOption);
  return suggestions.slice(0, 5).map(function (suggestion, index) {
    const source = suggestion && (suggestion.option || suggestion.item || suggestion.node || suggestion.candidate || suggestion.choice) || suggestion;
    const sourceObject = typeof source === "object" && source !== null ? source : { value: source };
    const matched = findMatchingOption(sourceObject, normalizedOptions) ||
      findMatchingOption(suggestion, normalizedOptions) ||
      normalizedOptions[index] ||
      {};
    const merged = Object.assign({}, matched, sourceObject, suggestion);
    const code = firstText(
      sourceObject.code,
      sourceObject.Code,
      sourceObject.optionCode,
      sourceObject.option_code,
      sourceObject.value,
      suggestion.code,
      suggestion.Code,
      suggestion.optionCode,
      suggestion.option_code,
      matched.code
    );
    const title = firstText(
      sourceObject.title,
      sourceObject.Title,
      sourceObject.name,
      sourceObject.Name,
      sourceObject.label,
      sourceObject.Label,
      suggestion.title,
      suggestion.Title,
      suggestion.name,
      suggestion.Name,
      suggestion.label,
      suggestion.Label,
      suggestion.optionTitle,
      suggestion.option_title,
      matched.title,
      matched.Title,
      code
    );
    return Object.assign({}, merged, {
      code,
      uri: firstText(sourceObject.uri, suggestion.uri, matched.uri),
      title,
      titleHu: firstText(sourceObject.titleHu, sourceObject.Title_HU, suggestion.titleHu, suggestion.Title_HU, matched.titleHu),
      description: firstText(sourceObject.description, sourceObject.Description, suggestion.description, suggestion.Description, matched.description),
      reason: firstText(suggestion.reason, suggestion.fitReason, suggestion.fit_reason, suggestion.explanation, suggestion.rationale, "Gemini ranked this option, but did not provide a reason."),
      fitScore: suggestion.fitScore || suggestion.score || suggestion.fit_score || null,
      risk: firstText(suggestion.risk, "medium"),
      nextQuestion: firstText(suggestion.nextQuestion, suggestion.next_question)
    });
  });
}

function findMatchingOption(source, options) {
  if (!source) return null;
  if (typeof source !== "object") {
    const raw = String(source).trim().toLowerCase();
    return options.find(function (option) {
      return String(option.code || "").toLowerCase() === raw ||
        String(option.uri || "").toLowerCase() === raw ||
        String(option.title || "").toLowerCase() === raw;
    });
  }
  const code = firstText(source.code, source.Code, source.optionCode, source.option_code, source.value);
  const uri = firstText(source.uri, source.URI);
  const title = firstText(source.title, source.Title, source.name, source.Name, source.label, source.Label, source.optionTitle, source.option_title);
  const lowerCode = code.toLowerCase();
  const lowerUri = uri.toLowerCase();
  const lowerTitle = title.toLowerCase();
  return options.find(function (option) {
    return (lowerCode && String(option.code || "").toLowerCase() === lowerCode) ||
      (lowerUri && String(option.uri || "").toLowerCase() === lowerUri) ||
      (lowerTitle && String(option.title || "").toLowerCase() === lowerTitle);
  });
}

function growthUnitDeckShape({ level, options, selectedPath }) {
  const normalizedOptions = (options || []).map(normalizeGraphOption).slice(0, 5);
  const focus = normalizedOptions[0] || {};
  return {
    deck_id: "string",
    target_decision_level: level,
    decision_context: `Current path: ${selectedPath && selectedPath.length ? selectedPath.map((item) => item.title).join(" > ") : "not selected yet"}`,
    options_available: normalizedOptions,
    growth_units: [
      {
        growth_unit_id: "string",
        reusable_key: `${level}:decision-literacy`,
        title: `Understand the ${level} decision`,
        card_type: "decision_literacy | option_comparison | self_fit_reflection",
        estimated_minutes: 4,
        profile_adaptation: "Explain how the card length, tone, and pressure level were adapted to the profile.",
        target_decision_level: level,
        user_state_snapshot: "Short profile-relevant state snapshot.",
        decision_question: "What should the learner understand before choosing the next graph node?",
        decision_context: "Why this decision matters now.",
        options_compared: normalizedOptions,
        concept_focus: {
          concept_id: focus.code || "decision-fit",
          name: focus.title || "Decision fit",
          definition: "A concept the learner needs before deciding."
        },
        learning_outcomes: [
          { description: "What the learner should understand after this card." }
        ],
        practice_outcomes: [
          { description: "What the learner can do immediately in the app after this card." }
        ],
        micro_materials: [
          {
            material_type: "explanation | reflection_question | comparison_task | mini_exercise",
            title: "string",
            content: "string",
            focus_concept: "string"
          }
        ],
        reflection_questions: ["string"],
        option_decision_guidance: [
          {
            option_code: "string",
            option_title: "string",
            when_to_choose: "string",
            caution: "string"
          }
        ],
        recommended_next_action: "Review the card, then choose one of the in-app graph options."
      }
    ]
  };
}

async function growthUnit(payload) {
  if (!payload.options || !payload.options.length) {
    throw serviceError("No current graph options are available. A Growth Unit card deck cannot be generated.", 422);
  }
  const shape = growthUnitDeckShape(payload);
  const prompt = `
Return a reusable Growth Unit card deck as strict JSON using this exact top-level shape:
${JSON.stringify(shape)}
Create 2-3 reusable learning cards. Each card must educate the learner before the current graph decision is made.
The cards are LMS content, not chat answers. They should be reusable for similar users and decisions, but personalized through profile_adaptation and examples.
Adapt content length and tone to the user profile:
- if burnout or blocked level is high, keep cards shorter, lower pressure, and focus on clarity;
- if learning agility and weekly time are high, include a slightly deeper comparison task;
- use the user's goals, competencies, values, and work history as examples.
LMS concepts from docs/LMS Concepts.docx: Learning Goal gives direction; Dynamic Learning Path adapts to the individual; Learning/Growth Units are reusable educational units that support understanding, practice, reflection, and a next decision.
The next action must be to choose one of the provided graph options in the app. Do not recommend an external interview, portfolio task, or web search as the primary next action.
Every growth_units[].options_compared item and option_decision_guidance item must correspond to one of the provided graph options.
Payload: ${JSON.stringify({ ...payload, profile: profileSignal(payload.profile) })}
`;
  const result = await askGemini(prompt, null);
  if (!result || !Array.isArray(result.growth_units) || !result.growth_units.length) {
    throw serviceError("Gemini did not return a valid Growth Unit card deck. Nothing was generated.", 502);
  }
  result.growth_units = result.growth_units.map(function (unit, index) {
    return Object.assign({}, unit, {
      growth_unit_id: unit.growth_unit_id || `${result.deck_id || "deck"}:${index + 1}`,
      options_compared: normalizeSuggestions(unit.options_compared || payload.options, payload.options)
    });
  });
  return result;
}

app.get("/api/status", async (_req, res) => {
  let neo4jConnected = false;
  let geminiAvailable = false;
  if (driver) {
    try {
      await readQuery("RETURN 1 AS ok");
      neo4jConnected = true;
    } catch {
      neo4jConnected = false;
    }
  }
  geminiAvailable = await checkGeminiAvailable();
  res.json({
    neo4jConfigured: neo4jReady,
    neo4jConnected,
    geminiConfigured: geminiReady,
    geminiAvailable,
    geminiModel: geminiReady ? preferredGeminiModel : null
  });
});

app.get("/api/neo4j/sectors", async (_req, res, next) => {
  try { res.json({ items: await getSectors() }); } catch (error) { next(error); }
});

app.get("/api/neo4j/occupations", async (req, res, next) => {
  try {
    const { sectorCode, level = "1", parentCode } = req.query;
    const items = parentCode ? await getChildOccupations(parentCode) : await getOccupationsBySector(sectorCode, level);
    res.json({ items });
  } catch (error) { next(error); }
});

app.get("/api/neo4j/jobs", async (req, res, next) => {
  try {
    const { occupationCode, parentCode } = req.query;
    const items = parentCode ? await getChildJobs(parentCode) : await getJobsUnderOccupation(occupationCode);
    res.json({ items });
  } catch (error) { next(error); }
});

app.get("/api/neo4j/jobs/:jobCode/competencies", async (req, res, next) => {
  try { res.json({ items: await getCompetenciesForJob(req.params.jobCode) }); } catch (error) { next(error); }
});

app.get("/api/neo4j/nodes/:code/sectors", async (req, res, next) => {
  try { res.json({ items: await getSectorsForNode(req.params.code) }); } catch (error) { next(error); }
});

app.post("/api/gemini/suggest-sectors", async (req, res, next) => {
  try { res.json(await suggest("sector", req.body.options || [], req.body.profile, req.body.context)); } catch (error) { next(error); }
});

app.post("/api/gemini/suggest-occupations", async (req, res, next) => {
  try { res.json(await suggest(req.body.level || "occupation", req.body.options || [], req.body.profile, req.body.context)); } catch (error) { next(error); }
});

app.post("/api/gemini/suggest-jobs", async (req, res, next) => {
  try { res.json(await suggest("job", req.body.options || [], req.body.profile, req.body.context)); } catch (error) { next(error); }
});

app.post("/api/gemini/growth-unit", async (req, res, next) => {
  try { res.json(await growthUnit(req.body)); } catch (error) { next(error); }
});

app.post("/api/gemini/chat", async (req, res, next) => {
  try {
    const prompt = `Return JSON {"message":"..."} as a concise career coach. Do not diagnose. Context: ${JSON.stringify(req.body)}`;
    const result = await askGemini(prompt, null);
    if (!result || !result.message) {
      throw serviceError("Gemini did not return a valid chat answer. Nothing was generated.", 502);
    }
    res.json(result);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({ error: error.message || "Unexpected server error" });
});

const server = app.listen(port, () => {
  console.log(`GapHopper LMS API listening on http://localhost:${port}`);
});

server.on("error", function (error) {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing server or set another PORT in .env, then restart npm run dev.`);
    process.exit(1);
  }
  throw error;
});
