const express = require("express");
const fs = require("fs");
const https = require("https");
const path = require("path");
const neo4j = require("neo4j-driver");
const { createGrowthUnitPrompt } = require("./prompts/growthUnitPrompt");
const { createChatGenerator } = require("./services/chatGeneration");
const { createSelectorGenerator } = require("./services/selectorGeneration");

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
const DEFAULT_ESSENTIAL_WEIGHT = 2;
const DEFAULT_OPTIONAL_WEIGHT = 1;

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

function requirementWeight(requirement, essentialWeight, optionalWeight) {
  return String(requirement || "").trim().toLowerCase() === "essential"
    ? essentialWeight
    : optionalWeight;
}

function mergeWeightedCompetencyRows(rows, essentialWeight, optionalWeight, limit) {
  const aggregates = new Map();
  const seenHits = new Set();

  rows.forEach(function (row) {
    const compKey = firstText(row.uri, row.Code, row.code, row.Title, row.title);
    if (!compKey) return;

    const requirement = firstText(row.requirement, "optional").toLowerCase();
    const hitKey = [
      compKey,
      firstText(row.job_uri, row.jobUri),
      firstText(row.source),
      requirement
    ].join("|");
    if (seenHits.has(hitKey)) return;
    seenHits.add(hitKey);

    if (!aggregates.has(compKey)) {
      aggregates.set(compKey, {
        uri: firstText(row.uri),
        Code: firstText(row.Code, row.code),
        code: firstText(row.code, row.Code),
        Title: firstText(row.Title, row.title),
        title: firstText(row.title, row.Title),
        Title_HU: firstText(row.Title_HU, row.titleHu),
        titleHu: firstText(row.titleHu, row.Title_HU),
        Type: firstText(row.Type, row.type),
        type: firstText(row.type, row.Type),
        Category: firstText(row.Category, row.category),
        category: firstText(row.category, row.Category),
        Description: firstText(row.Description, row.description),
        description: firstText(row.description, row.Description),
        score: 0,
        hits: 0,
        job_count: 0,
        essential_hits: 0,
        optional_hits: 0,
        sources: [],
        jobs: [],
        _jobUris: new Set()
      });
    }

    const aggregate = aggregates.get(compKey);
    aggregate.score += requirementWeight(requirement, essentialWeight, optionalWeight);
    aggregate.hits += 1;
    if (requirement === "essential") aggregate.essential_hits += 1;
    else aggregate.optional_hits += 1;

    const source = firstText(row.source);
    const jobTitle = firstText(row.job_title, row.jobTitle);
    const jobUri = firstText(row.job_uri, row.jobUri);
    if (source && aggregate.sources.indexOf(source) === -1) aggregate.sources.push(source);
    if (jobTitle && aggregate.jobs.indexOf(jobTitle) === -1) aggregate.jobs.push(jobTitle);
    if (jobUri) aggregate._jobUris.add(jobUri);
  });

  return Array.from(aggregates.values()).map(function (row) {
    row.score = Math.round(row.score * 100) / 100;
    row.job_count = row._jobUris.size;
    row.jobCount = row.job_count;
    row.essentialHits = row.essential_hits;
    row.optionalHits = row.optional_hits;
    row.sources = row.sources.slice(0, 8);
    row.jobs = row.jobs.slice(0, 8);
    delete row._jobUris;
    return row;
  }).sort(function (a, b) {
    return (b.score - a.score) ||
      (b.essential_hits - a.essential_hits) ||
      firstText(a.Title, a.Code).localeCompare(firstText(b.Title, b.Code));
  }).slice(0, limit);
}

async function getNodeSummary(identifier) {
  const rows = await readQuery(`
    MATCH (n)
    WHERE (n.uri = $identifier OR n.Code = $identifier) AND (n:Occupation OR n:Job)
    RETURN labels(n) AS labels,
           n.uri AS uri,
           n.Code AS code,
           n.Level AS level,
           coalesce(n.Title, n.Title_HU, n.Code) AS title,
           coalesce(n.Title_HU, n.Title, n.Code) AS titleHu,
           coalesce(n.Description, n.Description_HU, "") AS description
    LIMIT 1
  `, { identifier });
  return rows[0] || null;
}

async function getDownstreamJobsForNode(identifier) {
  return readQuery(`
    MATCH (start)
    WHERE (start.uri = $identifier OR start.Code = $identifier)
      AND (start:Occupation OR start:Job)
    CALL {
      WITH start
      WITH start WHERE start:Job
      RETURN start AS job
      UNION
      WITH start
      WITH start WHERE start:Occupation
      MATCH (job:Job)-[:HasParentOccupation*0..]->(start)
      RETURN job AS job
    }
    RETURN DISTINCT job.uri AS uri,
           job.Code AS code,
           job.Level AS level,
           coalesce(job.Title, job.Title_HU, job.Code) AS title,
           coalesce(job.Title_HU, job.Title, job.Code) AS titleHu,
           coalesce(job.Description, job.Description_HU, "") AS description
    ORDER BY code, title
  `, { identifier });
}

async function aggregateEscoCompetencies(jobUris, essentialWeight, optionalWeight, limit) {
  if (!jobUris.length) return [];
  const directRows = await readQuery(`
    MATCH (job:Job)-[job_req:RequiresCompetency]->(competency:Competency)
    WHERE job.uri IN $jobUris
      AND NOT EXISTS {
        MATCH (:Competency)-[:HasParentCompetency]->(competency)
      }
    RETURN DISTINCT competency.uri AS uri,
           competency.Code AS code,
           competency.Code AS Code,
           competency.Title AS title,
           competency.Title AS Title,
           competency.Title_HU AS titleHu,
           competency.Title_HU AS Title_HU,
           competency.Type AS type,
           competency.Type AS Type,
           competency.Category AS category,
           competency.Category AS Category,
           competency.Description AS description,
           competency.Description AS Description,
           toLower(coalesce(job_req.relation_type, job_req.connection_type, job_req.Type, "optional")) AS requirement,
           coalesce(job.Title, job.Code, job.uri) AS source,
           job.uri AS job_uri,
           coalesce(job.Title, job.Code, job.uri) AS job_title
  `, { jobUris });
  const viaConceptRows = await readQuery(`
    MATCH (job:Job)-[job_req:RequiresCompetency]->(concept)
    WHERE job.uri IN $jobUris
      AND any(label IN labels(concept) WHERE label IN ["Activity", "Tool"])
    MATCH (concept)-[:HasParentCompetency|RequiresCompetency]->(competency:Competency)
    WHERE NOT EXISTS {
      MATCH (:Competency)-[:HasParentCompetency]->(competency)
    }
    RETURN DISTINCT competency.uri AS uri,
           competency.Code AS code,
           competency.Code AS Code,
           competency.Title AS title,
           competency.Title AS Title,
           competency.Title_HU AS titleHu,
           competency.Title_HU AS Title_HU,
           competency.Type AS type,
           competency.Type AS Type,
           competency.Category AS category,
           competency.Category AS Category,
           competency.Description AS description,
           competency.Description AS Description,
           toLower(coalesce(job_req.relation_type, job_req.connection_type, job_req.Type, "optional")) AS requirement,
           coalesce(concept.Title, concept.Code, concept.uri) AS source,
           job.uri AS job_uri,
           coalesce(job.Title, job.Code, job.uri) AS job_title
  `, { jobUris });
  return mergeWeightedCompetencyRows(directRows.concat(viaConceptRows), essentialWeight, optionalWeight, limit);
}

async function aggregateGhCompetencies(jobUris, essentialWeight, optionalWeight, limit) {
  if (!jobUris.length) return [];
  const directRows = await readQuery(`
    MATCH (job:Job)-[gh_req:GH_RequiresCompetency]->(gh:GH_Competency)
    WHERE job.uri IN $jobUris
      AND NOT EXISTS {
        MATCH (:GH_Competency)-[:GH_HasParentCompetency]->(gh)
      }
    RETURN DISTINCT gh.uri AS uri,
           gh.Code AS code,
           gh.Code AS Code,
           gh.Title AS title,
           gh.Title AS Title,
           gh.Title_HU AS titleHu,
           gh.Title_HU AS Title_HU,
           gh.Type AS type,
           gh.Type AS Type,
           gh.Description AS description,
           gh.Description AS Description,
           toLower(coalesce(gh_req.connection_type, gh_req.relation_type, gh_req.Type, "optional")) AS requirement,
           coalesce(job.Title, job.Code, job.uri) AS source,
           job.uri AS job_uri,
           coalesce(job.Title, job.Code, job.uri) AS job_title
  `, { jobUris });
  const viaConceptRows = await readQuery(`
    MATCH (job:Job)-[job_req:RequiresCompetency]->(concept)-[:GH_RequiresCompetency]->(gh:GH_Competency)
    WHERE job.uri IN $jobUris
      AND any(label IN labels(concept) WHERE label IN ["Activity", "Tool", "Competency"])
      AND NOT EXISTS {
        MATCH (:GH_Competency)-[:GH_HasParentCompetency]->(gh)
      }
    RETURN DISTINCT gh.uri AS uri,
           gh.Code AS code,
           gh.Code AS Code,
           gh.Title AS title,
           gh.Title AS Title,
           gh.Title_HU AS titleHu,
           gh.Title_HU AS Title_HU,
           gh.Type AS type,
           gh.Type AS Type,
           gh.Description AS description,
           gh.Description AS Description,
           toLower(coalesce(job_req.relation_type, job_req.connection_type, job_req.Type, "optional")) AS requirement,
           coalesce(concept.Title, concept.Code, concept.uri) AS source,
           job.uri AS job_uri,
           coalesce(job.Title, job.Code, job.uri) AS job_title
  `, { jobUris });
  return mergeWeightedCompetencyRows(directRows.concat(viaConceptRows), essentialWeight, optionalWeight, limit);
}

async function getWeightedCompetencyProfile(identifier, options) {
  const essentialWeight = Number(options.essentialWeight || DEFAULT_ESSENTIAL_WEIGHT);
  const optionalWeight = Number(options.optionalWeight || DEFAULT_OPTIONAL_WEIGHT);
  const limit = Math.max(10, Math.min(500, Number(options.limit || 100)));
  const node = await getNodeSummary(identifier);
  if (!node) throw serviceError("No Occupation or Job node was found for this card.", 404);
  const jobs = await getDownstreamJobsForNode(identifier);
  const jobUris = jobs.map(function (job) { return job.uri; }).filter(Boolean);
  const competencies = await aggregateEscoCompetencies(jobUris, essentialWeight, optionalWeight, limit);
  const ghCompetencies = await aggregateGhCompetencies(jobUris, essentialWeight, optionalWeight, limit);
  return {
    node,
    jobs,
    competencies,
    gh_competencies: ghCompetencies,
    ghCompetencies,
    weights: {
      essential: essentialWeight,
      optional: optionalWeight
    }
  };
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

const { suggest } = createSelectorGenerator({
  askGemini,
  serviceError,
  profileSignal,
  normalizeGraphOption,
  firstText
});

const { chat } = createChatGenerator({
  askGemini,
  serviceError
});

function growthUnitLengthGuide(payload) {
  const explicitLength = firstText(payload.LENGTH, payload.length, payload.material_length, payload.materialLength, payload.target_length);
  const signal = profileSignal(payload.profile);
  const weeklyTime = Number(signal.learningAgility.weekly_time_investment || 0);
  let minutes = Number(payload.estimated_minutes || payload.estimatedMinutes || 0);
  if (!minutes) {
    if (/short|rövid/i.test(explicitLength)) minutes = 5;
    else if (/long|hossz/i.test(explicitLength)) minutes = 15;
    else if (/medium|közep/i.test(explicitLength)) minutes = 10;
    else if (weeklyTime >= 8) minutes = 12;
    else if (weeklyTime >= 4) minutes = 8;
    else minutes = 5;
  }
  const wordsPerCard = Math.max(350, minutes * 90);
  return {
    requested_length: explicitLength || `${minutes} minutes`,
    target_minutes_per_card: minutes,
    minimum_words_per_card: wordsPerCard,
    micro_material_count: minutes >= 10 ? 4 : 3,
    guidance: `Each Growth Unit card should read like a ${minutes}-minute LMS lesson, not a summary. Use at least ${wordsPerCard} words per card across decision_context, concept_focus.definition, micro_materials, reflection_questions, and recommended_next_action.`
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
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.45
    }
  });

  const models = await getGeminiModelCandidates();
  var lastError = null;
  for (var i = 0; i < models.length; i += 1) {
    try {
      const text = await postGeminiGenerateContentWithRetry(models[i], body);
      const parsed = JSON.parse(text);
      const candidate = parsed.candidates && parsed.candidates[0];
      const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
      return extractJson((part && part.text) || "", fallback);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error)) throw error;
    }
  }
  throw lastError || new Error("Gemini request failed");
}

function isRetryableGeminiError(error) {
  const statusCode = Number(error && error.statusCode);
  return statusCode === 404 || statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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

async function postGeminiGenerateContentWithRetry(model, body) {
  try {
    return await postGeminiGenerateContent(model, body);
  } catch (error) {
    if (!isRetryableGeminiError(error) || Number(error.statusCode) === 404) {
      throw error;
    }
    await wait(650);
    return postGeminiGenerateContent(model, body);
  }
}

function growthUnitDeckShape({ level, options, selectedPath, lengthGuide }) {
  const normalizedOptions = (options || []).map(normalizeGraphOption).slice(0, 5);
  const focus = normalizedOptions[0] || {};
  const guide = lengthGuide || {};
  return {
    deck_id: "string",
    target_decision_level: level,
    decision_context: `Current path: ${selectedPath && selectedPath.length ? selectedPath.map((item) => item.title).join(" > ") : "not selected yet"}`,
    options_available: normalizedOptions,
    length_guide: guide,
    growth_units: [
      {
        growth_unit_id: "string",
        reusable_key: `${level}:decision-literacy`,
        title: `Understand the ${level} decision`,
        card_type: "decision_literacy | option_comparison | self_fit_reflection",
        estimated_minutes: guide.target_minutes_per_card || 8,
        profile_adaptation: "Explain how the card length, tone, and pressure level were adapted to the profile.",
        target_decision_level: level,
        user_state_snapshot: "Short profile-relevant state snapshot.",
        decision_question: "What should the learner understand before choosing the next graph node?",
        decision_context: "A substantial explanation of why this decision matters now and what knowledge is needed before choosing.",
        concept_focus: {
          concept_id: focus.code || "decision-fit",
          name: focus.title || "Decision fit",
          definition: "A developed concept explanation the learner needs before deciding, including how the available options should be understood as learning concepts."
        },
        learning_outcomes: [
          { description: "The learner can explain the decision concept in their own words." },
          { description: "The learner can identify which option attributes matter for their personal goal." }
        ],
        practice_outcomes: [
          { description: "The learner can choose from the right-side Decision Options panel and justify the choice." }
        ],
        micro_materials: [
          {
            material_type: "concept_explanation | option_concept_note | reflection_question | mini_exercise",
            title: "string",
            content: "Substantial teaching content, example, or exercise instructions matched to the requested length.",
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

function fallbackGrowthUnitDeck(payload, lengthGuide) {
  const normalizedOptions = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const focus = normalizedOptions[0] || {};
  const level = payload.level || "decision";
  const pathText = payload.selectedPath && payload.selectedPath.length
    ? payload.selectedPath.map(function (item) { return item.title; }).join(" > ")
    : "starting from the broad career graph";
  const optionTitles = normalizedOptions.map(function (item) { return item.title; }).filter(Boolean).join(", ") || "the current Decision Options";
  const minutes = lengthGuide.target_minutes_per_card || 8;
  return {
    deck_id: `${level}:local-growth-unit`,
    target_decision_level: level,
    decision_context: `Current path: ${pathText}`,
    options_available: normalizedOptions,
    length_guide: lengthGuide,
    generated_by: "local_fallback",
    growth_units: [
      {
        growth_unit_id: `${level}:decision-concept`,
        reusable_key: `${level}:decision-concept`,
        title: `Understand the ${level} choice before narrowing the path`,
        card_type: "decision_literacy",
        estimated_minutes: minutes,
        profile_adaptation: "This unit keeps the decision practical and grounded in the learner profile, while giving enough explanation to support an informed choice instead of a quick click.",
        target_decision_level: level,
        user_state_snapshot: "The learner is narrowing a broad career graph toward a more specific work role and needs enough concept knowledge to compare the visible options.",
        decision_question: "Which direction best preserves motivation, capability fit, and realistic next-step clarity?",
        decision_context: `At this stage the learner is not choosing a final job yet; they are reducing a wide search space into a more meaningful path. The visible Decision Options represent possible concepts in the career graph, such as sectors, occupation families, role clusters, or job directions. A useful choice should connect to the learner's goals, existing strengths, values, and learning capacity. The key is to avoid treating the highest-ranked option as automatically correct. Instead, the learner should understand what each option means, what kind of work identity it points toward, and what it would make easier or harder in later steps. The current path is ${pathText}, and the visible options are ${optionTitles}.`,
        concept_focus: {
          concept_id: focus.code || "career-search-narrowing",
          name: "Career search narrowing",
          definition: "Career search narrowing is the skill of reducing a broad opportunity space into a smaller set of meaningful directions without losing sight of personal fit. It combines three kinds of evidence: goal alignment, capability fit, and future optionality. Goal alignment asks whether the option supports what the learner wants more of in work. Capability fit asks whether existing competencies, experience, and learning agility make the path plausible. Future optionality asks whether the choice keeps enough doors open for the next graph step. The Decision Options should therefore be read as learning concepts, not only as labels. Each option teaches something about the type of work, learning path, and tradeoffs that may follow.",
        },
        learning_outcomes: [
          { description: "The learner can explain how the current decision narrows a broad career search toward a more specific work role." },
          { description: "The learner can compare Decision Options using goal alignment, capability fit, and future optionality." },
          { description: "The learner can describe why an option may be useful even when it is not the final job target." }
        ],
        practice_outcomes: [
          { description: "The learner can select one option from the right-side Decision Options panel and state the evidence behind the choice." },
          { description: "The learner can reject an appealing option when it does not support the next narrowing step." }
        ],
        micro_materials: [
          {
            material_type: "concept_explanation",
            title: "Read options as concepts",
            content: "Before choosing, read each option as a concept that explains a possible direction of work. A sector option is not just an industry label; it suggests environments, problems, customers, tools, and value systems. An occupation option is not just a role family; it suggests recurring tasks, capability requirements, and learning investments. A job option is more concrete, but it still needs interpretation: it points to daily work patterns and expectations. This reading helps the learner avoid shallow matching and instead ask what each option would teach them about their next career step.",
            focus_concept: "career-search-narrowing"
          },
          {
            material_type: "mini_exercise",
            title: "Use a three-question filter",
            content: "For each visible Decision Option, answer three questions before choosing. First: does this option support the learner's primary goal or work values? Second: does it connect to existing competencies, experience, or a realistic learning pace? Third: does it keep the next step clear enough to continue narrowing the graph? If an option scores well on all three, it is a strong candidate. If it scores well on only one, it may still be interesting, but the learner should know what risk or uncertainty they are accepting.",
            focus_concept: "decision evidence"
          },
          {
            material_type: "option_concept_note",
            title: "What the shortlist means",
            content: `The current shortlist contains ${normalizedOptions.length} visible options: ${optionTitles}. This does not mean the rest of the career graph disappeared. It means the system is presenting a smaller, more usable choice set for the current decision. The learner should use the shortlist to make progress, while remembering that each selection opens a new branch and hides many less relevant branches. Good narrowing is not about finding perfection immediately; it is about choosing the next branch that has the best evidence now.`,
            focus_concept: "shortlist"
          }
        ],
        reflection_questions: [
          "Which option would make the next step clearer rather than just more interesting?",
          "What evidence from the profile supports the strongest option?",
          "Which option looks attractive but may not fit the learner's current learning capacity?"
        ],
        option_decision_guidance: normalizedOptions.map(function (option) {
          return {
            option_code: option.code || option.uri || option.title,
            option_title: option.title,
            when_to_choose: "Choose this when its work direction, capability requirements, and next graph step fit the learner's current goals.",
            caution: "Do not choose it only because the label sounds appealing; check the evidence from the profile and the next-step clarity."
          };
        }),
        recommended_next_action: "Review the concept, then choose one option from the right-side Decision Options panel."
      }
    ]
  };
}

function normalizeGrowthUnitDeck(result, payload, lengthGuide) {
  const fallback = fallbackGrowthUnitDeck(payload, lengthGuide);
  if (!result) return fallback;
  const source = Array.isArray(result) ? { growth_units: result } : result;
  const nestedDeck = source.deck || source.growth_unit_deck || source.growthUnitDeck || {};
  const units = source.growth_units ||
    source.growthUnits ||
    source.units ||
    source.cards ||
    nestedDeck.growth_units ||
    nestedDeck.growthUnits ||
    nestedDeck.units ||
    nestedDeck.cards;
  if (!Array.isArray(units) || !units.length) return fallback;
  return Object.assign({}, fallback, source, nestedDeck, {
    deck_id: source.deck_id || nestedDeck.deck_id || fallback.deck_id,
    target_decision_level: source.target_decision_level || nestedDeck.target_decision_level || fallback.target_decision_level,
    decision_context: source.decision_context || nestedDeck.decision_context || fallback.decision_context,
    options_available: source.options_available || nestedDeck.options_available || fallback.options_available,
    length_guide: source.length_guide || nestedDeck.length_guide || lengthGuide,
    growth_units: units.map(function (unit, index) {
      const fallbackUnit = fallback.growth_units[Math.min(index, fallback.growth_units.length - 1)];
      return Object.assign({}, fallbackUnit, unit, {
        growth_unit_id: unit.growth_unit_id || unit.id || `${source.deck_id || fallback.deck_id}:${index + 1}`,
        target_decision_level: unit.target_decision_level || payload.level || fallback.target_decision_level,
        estimated_minutes: unit.estimated_minutes || lengthGuide.target_minutes_per_card || fallbackUnit.estimated_minutes,
        learning_outcomes: Array.isArray(unit.learning_outcomes) && unit.learning_outcomes.length ? unit.learning_outcomes : fallbackUnit.learning_outcomes,
        practice_outcomes: Array.isArray(unit.practice_outcomes) && unit.practice_outcomes.length ? unit.practice_outcomes : fallbackUnit.practice_outcomes,
        micro_materials: Array.isArray(unit.micro_materials) && unit.micro_materials.length ? unit.micro_materials : fallbackUnit.micro_materials,
        reflection_questions: Array.isArray(unit.reflection_questions) && unit.reflection_questions.length ? unit.reflection_questions : fallbackUnit.reflection_questions,
        recommended_next_action: unit.recommended_next_action || fallbackUnit.recommended_next_action
      });
    })
  });
}

function compactCompetencyRows(rows, count) {
  return (rows || []).slice(0, count).map(function (row) {
    return {
      code: firstText(row.code, row.Code),
      title: firstText(row.title, row.Title),
      type: firstText(row.type, row.Type),
      score: row.score,
      job_count: row.job_count || row.jobCount || 0,
      essential_hits: row.essential_hits || row.essentialHits || 0,
      optional_hits: row.optional_hits || row.optionalHits || 0,
      sources: (row.sources || []).slice(0, 4)
    };
  });
}

function shouldAttachCompetencyProfiles(level) {
  return level === "job" || String(level || "").indexOf("occupation") === 0;
}

async function buildGrowthUnitCompetencyProfiles(payload) {
  if (!shouldAttachCompetencyProfiles(payload.level)) return [];
  const options = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const profiles = await Promise.all(options.map(async function (option) {
    const identifier = firstText(option.uri, option.code);
    if (!identifier) {
      return {
        option_code: option.code,
        option_title: option.title,
        error: "No uri or code available for competency profile lookup."
      };
    }
    try {
      const profile = await getWeightedCompetencyProfile(identifier, {
        essentialWeight: DEFAULT_ESSENTIAL_WEIGHT,
        optionalWeight: DEFAULT_OPTIONAL_WEIGHT,
        limit: 30
      });
      return {
        option_code: option.code,
        option_title: option.title,
        node_uri: profile.node && profile.node.uri,
        downstream_job_count: (profile.jobs || []).length,
        weights: profile.weights,
        top_esco_competencies: compactCompetencyRows(profile.competencies, 12),
        top_gh_competencies: compactCompetencyRows(profile.ghCompetencies || profile.gh_competencies, 12)
      };
    } catch (error) {
      return {
        option_code: option.code,
        option_title: option.title,
        error: error.message
      };
    }
  }));
  return profiles;
}

async function growthUnit(payload) {
  if (!payload.options || !payload.options.length) {
    throw serviceError("No current graph options are available. A Growth Unit card deck cannot be generated.", 422);
  }
  const lengthGuide = growthUnitLengthGuide(payload);
  const competencyProfiles = await buildGrowthUnitCompetencyProfiles(payload);
  const enrichedPayload = Object.assign({}, payload, {
    competencyProfiles,
    weighted_competency_profiles: competencyProfiles
  });
  const shape = growthUnitDeckShape(Object.assign({}, enrichedPayload, { lengthGuide }));
  const prompt = createGrowthUnitPrompt({
    shape,
    lengthGuide,
    enrichedPayload,
    profileSignal: profileSignal(payload.profile)
  });
  const result = await askGemini(prompt, fallbackGrowthUnitDeck(enrichedPayload, lengthGuide));
  return normalizeGrowthUnitDeck(result, enrichedPayload, lengthGuide);
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

app.post("/api/neo4j/competency-profile", async (req, res, next) => {
  try {
    const identifier = firstText(req.body.uri, req.body.code);
    if (!identifier) throw serviceError("A node uri or code is required.", 400);
    res.json(await getWeightedCompetencyProfile(identifier, req.body));
  } catch (error) { next(error); }
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
  try { res.json(await chat(req.body)); } catch (error) { next(error); }
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
