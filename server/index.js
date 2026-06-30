const express = require("express");
const fs = require("fs");
const https = require("https");
const path = require("path");
const neo4j = require("neo4j-driver");
const { createGrowthUnitPrompt } = require("./prompts/growthUnitPrompt");
const { createCompetencyGrowthUnitPrompt } = require("./prompts/competencyGrowthUnitPrompt");
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

async function writeQuery(query, params) {
  requireNeo4j();
  params = params || {};
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.writeTransaction(function (tx) {
      return tx.run(query, params);
    });
    return result.records.map(toPlain);
  } finally {
    await session.close();
  }
}

function graphNodeKey(item, fallback) {
  return firstText(item && item.uri, item && item.URI, item && item.code, item && item.Code, item && item.id, item && item.title, fallback);
}

function learningMaterialCacheKey(parts) {
  return parts.map(function (part) {
    return String(part || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  }).join(":");
}

function parseJsonProperty(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cacheGeneratedBy(deck, source) {
  return Object.assign({}, deck, {
    generated_by: source,
    cache_status: source
  });
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
  const explicitMinutes = Number((String(explicitLength || "").match(/\d+(?:\.\d+)?/) || [])[0] || 0);
  if (!minutes) {
    if (/<\s*2|under\s*2|less than\s*2/i.test(explicitLength)) minutes = 1;
    else if (/2\s*-\s*5|2\s*to\s*5/i.test(explicitLength)) minutes = 4;
    else if (/5\s*-\s*10|5\s*to\s*10|medium|közep/i.test(explicitLength)) minutes = 8;
    else if (/10\s*-\s*20|10\s*to\s*20|long|hossz/i.test(explicitLength)) minutes = 15;
    else if (/>+\s*20|over\s*20|more than\s*20/i.test(explicitLength)) minutes = 25;
    else if (/short|rövid/i.test(explicitLength)) minutes = 4;
    else if (explicitMinutes) minutes = explicitMinutes;
    else if (weeklyTime >= 8) minutes = 12;
    else if (weeklyTime >= 4) minutes = 8;
    else minutes = 5;
  }
  const buckets = [
    { label: "<2min", min: 0, max: 2, target: 1, words: 150, materials: 1 },
    { label: "2-5min", min: 2, max: 5, target: 4, words: 350, materials: 2 },
    { label: "5-10min", min: 5, max: 10, target: 8, words: 700, materials: 3 },
    { label: "10-20min", min: 10, max: 20, target: 15, words: 1200, materials: 4 },
    { label: ">20min", min: 20, max: Infinity, target: 25, words: 1800, materials: 5 }
  ];
  const bucket = buckets.find(function (item) {
    return minutes < item.max;
  }) || buckets[buckets.length - 1];
  return {
    requested_length: explicitLength || bucket.label,
    length_bucket: bucket.label,
    target_minutes_per_card: bucket.target,
    minimum_words_per_card: bucket.words,
    micro_material_count: bucket.materials,
    available_length_buckets: buckets.map(function (item) { return item.label; }),
    guidance: `Quantize the requested length to ${bucket.label}. Each Growth Unit must be a complete ${bucket.target}-minute LMS lesson, not a card summary. Use at least ${bucket.words} words per lesson across decision_context, concept_focus.definition, lesson_sections, micro_materials, knowledge_checks, reflection_questions, and recommended_next_action.`
  };
}

function competencyGrowthUnitLengthGuide(payload) {
  const guide = growthUnitLengthGuide(payload);
  return Object.assign({}, guide, {
    guidance: `Each competency Growth Unit must be a complete ${guide.target_minutes_per_card}-minute LMS lesson, not a card summary. Use at least ${guide.minimum_words_per_card} words per lesson across knowledge_context, competency_focus.definition, current_level_fit, lesson_sections, micro_materials, knowledge_checks, reflection_questions, and recommended_next_action.`
  });
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
      maxOutputTokens: 24576,
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
  const guide = lengthGuide || {};
  return {
    deck_id: "string",
    target_decision_level: level,
    decision_context: `Current path: ${selectedPath && selectedPath.length ? selectedPath.map((item) => item.title).join(" > ") : "not selected yet"}`,
    options_available: normalizedOptions,
    length_guide: guide,
    growth_units: normalizedOptions.map(function (option) {
      return {
        growth_unit_id: `${level}:${option.code || option.uri || option.title || "option"}:explanation`,
        reusable_key: `${level}:${option.code || option.uri || option.title || "option"}:growth-unit`,
        title: `Full lesson: ${option.title || "this option"}`,
        lesson_type: "full_lesson",
        card_type: "full_option_lesson | full_competency_lesson",
        estimated_minutes: guide.target_minutes_per_card || 8,
        profile_adaptation: "Explain how the lesson length, tone, and pressure level were adapted to the profile.",
        target_decision_level: level,
        user_state_snapshot: "Short profile-relevant state snapshot.",
        option_focus: {
          option_code: option.code || option.uri || "option",
          option_title: option.title || "Selected option",
          option_level: option.level || level,
          option_uri: option.uri || ""
        },
        decision_question: `What should the learner understand about ${option.title || "this option"} before selecting it?`,
        decision_context: "A substantial standalone explanation of this option as a learning object. Do not compare it against other options.",
        concept_focus: {
          concept_id: option.code || option.uri || "option-understanding",
          name: option.title || "Selected option",
          definition: "A developed explanation of what this sector, occupation, or job means, including typical work, learning demands, and fit signals."
        },
        learning_outcomes: [
          { description: "The learner can explain this option in their own words." },
          { description: "The learner can identify the competencies, work patterns, or learning demands that matter for this option." }
        ],
        lesson_sections: [
          {
            section_type: "orientation | concept_teaching | competency_teaching | worked_example | guided_practice | self_assessment | summary",
            title: "string",
            content: "Complete lesson section content matched to the requested length bucket.",
            estimated_minutes: 1
          }
        ],
        practice_outcomes: [
          { description: "The learner can decide whether this option deserves selection from the right-side Decision Options panel." }
        ],
        micro_materials: [
          {
            material_type: "concept_explanation | option_concept_note | competency_explanation | reflection_question | mini_exercise",
            title: "string",
            content: "Substantial teaching content, example, or exercise instructions matched to the requested length.",
            focus_concept: "string"
          }
        ],
        knowledge_checks: [
          {
            question: "string",
            expected_answer: "string",
            feedback: "string"
          }
        ],
        reflection_questions: ["string"],
        option_decision_guidance: [],
        lesson_completion_criteria: "The learner can summarize the option, name the main competency or learning demand, complete the check, and decide whether to select the option.",
        recommended_next_action: "Complete the full lesson, then select this option from the in-app graph options only if it fits the learner's goal and evidence."
      };
    })
  };
}

function normalizeCompetencyOption(competency) {
  if (!competency) return {};
  return Object.assign({}, competency, {
    code: firstText(competency.code, competency.Code, competency.id, competency.ID, competency.uri),
    uri: firstText(competency.uri, competency.URI),
    title: firstText(competency.title, competency.Title, competency.name, competency.Name, competency.label, competency.Label, competency.code, competency.Code),
    titleHu: firstText(competency.titleHu, competency.Title_HU, competency.TitleHu, competency.Title),
    type: firstText(competency.type, competency.Type, competency.category, competency.Category),
    description: firstText(competency.description, competency.Description, competency.descriptionHu, competency.Description_HU, ""),
    score: Number(competency.score || 0),
    rank: Number(competency.rank || competency.Rank || 0),
    job_count: Number(competency.job_count || competency.jobCount || 0),
    essential_hits: Number(competency.essential_hits || competency.essentialHits || 0),
    optional_hits: Number(competency.optional_hits || competency.optionalHits || 0),
    sources: Array.isArray(competency.sources) ? competency.sources.slice(0, 8) : []
  });
}

function competencyLevelLabel(level) {
  const labels = {
    1: "novice",
    2: "basic",
    3: "working",
    4: "advanced",
    5: "expert"
  };
  return labels[level] || labels[1];
}

function normalizeCompetencyLevel(payload) {
  const value = Number(
    payload.user_competency_level_1_to_5 ||
    payload.userCompetencyLevel ||
    payload.competency_level ||
    payload.competencyLevel ||
    payload.level_1_to_5 ||
    1
  );
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function isKnowledgeCompetency(competency) {
  return /knowledge/i.test(firstText(competency.type, competency.Type, competency.category, competency.Category));
}

function booleanFromValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
  }
  return Boolean(value);
}

function competencyGrowthUnitDeckShape({ highlightedNode, selectedCompetency, userCompetencyLevel, lengthGuide }) {
  const node = normalizeGraphOption(highlightedNode);
  const competency = normalizeCompetencyOption(selectedCompetency);
  const guide = lengthGuide || {};
  const levelLabel = competencyLevelLabel(userCompetencyLevel);
  return {
    deck_id: "string",
    deck_type: "competency_growth_unit",
    can_generate: true,
    generation_note: "Generated only for Knowledge type competencies.",
    highlighted_node: node,
    selected_competency: competency,
    user_competency_level_1_to_5: userCompetencyLevel,
    level_interpretation: `Learner is at ${levelLabel} level for this knowledge area.`,
    length_guide: guide,
    growth_units: [
      {
        growth_unit_id: "string",
        reusable_key: `${firstText(competency.code, "knowledge")}:competency-growth`,
        title: `Build knowledge of ${competency.title || "the selected competency"}`,
        lesson_type: "full_lesson",
        card_type: "full_competency_lesson",
        estimated_minutes: guide.target_minutes_per_card || 8,
        profile_adaptation: "Explain how the content was adapted to the learner profile and the 1-5 competency level.",
        target_node_level: node.level || "occupation_or_job",
        user_state_snapshot: "Short profile-relevant state snapshot.",
        competency_question: "What should the learner understand about this knowledge competency?",
        knowledge_context: "A substantial explanation of why this knowledge matters for the highlighted occupation/job.",
        competency_focus: {
          competency_id: competency.code || competency.uri || "knowledge-competency",
          name: competency.title || "Selected knowledge competency",
          type: "Knowledge",
          definition: "A developed explanation of the selected knowledge competency.",
          why_it_matters_for_node: "How this knowledge supports the highlighted occupation/job."
        },
        current_level_fit: {
          level: userCompetencyLevel,
          level_label: levelLabel,
          what_the_learner_likely_knows: "string",
          next_understanding_step: "string"
        },
        learning_outcomes: [
          { description: "The learner can explain the knowledge concept in their own words." },
          { description: "The learner can recognize where this knowledge appears in the highlighted occupation/job." }
        ],
        knowledge_practice_outcomes: [
          { description: "The learner can use a short self-check to identify the next understanding gap." }
        ],
        lesson_sections: [
          {
            section_type: "orientation | concept_teaching | worked_example | guided_practice | self_assessment | summary",
            title: "string",
            content: "Substantial lesson content matched to the requested length.",
            estimated_minutes: 2,
            focus_concept: "string"
          }
        ],
        micro_materials: [
          {
            material_type: "knowledge_explanation | worked_example | misconception_check | mini_exercise | self_check",
            title: "string",
            content: "Substantial teaching content, example, misconception check, or exercise instructions matched to the requested length.",
            focus_concept: "string"
          }
        ],
        knowledge_checks: [
          {
            question: "string",
            expected_answer: "string",
            feedback: "string"
          }
        ],
        lesson_completion_criteria: "The learner can explain the competency, complete the check, and identify the next knowledge gap.",
        reflection_questions: ["string"],
        recommended_next_action: "Review the knowledge card, then return to the highlighted occupation/job competency list."
      }
    ]
  };
}

function matchingCompetencyProfile(option, profiles) {
  const optionCode = firstText(option.code, option.Code, option.uri);
  return (profiles || []).find(function (profile) {
    return firstText(profile.option_code, profile.node_uri) === optionCode ||
      firstText(profile.option_title) === firstText(option.title);
  }) || {};
}

function competencySummaryForOption(profile) {
  const rows = []
    .concat(profile.top_esco_competencies || [])
    .concat(profile.top_gh_competencies || [])
    .filter(Boolean)
    .sort(function (a, b) {
      return Number(b.score || 0) - Number(a.score || 0);
    })
    .slice(0, 5);
  if (!rows.length) {
    return "No weighted competency profile is available for this option yet, so the learner should focus on the option meaning, work pattern, and fit signals.";
  }
  return rows.map(function (row) {
    const title = firstText(row.title, row.code, "Unnamed competency");
    return `${title} (score ${row.score || 0}, essential ${row.essential_hits || 0}, optional ${row.optional_hits || 0})`;
  }).join("; ");
}

function optionGrowthUnitFallback({ option, level, pathText, lengthGuide, profile }) {
  const optionTitle = option.title || "this option";
  const profileText = competencySummaryForOption(profile);
  const hasCompetencies = Boolean((profile.top_esco_competencies || []).length || (profile.top_gh_competencies || []).length);
  const conceptDefinition = `${optionTitle} should be read as a standalone learning object in the career graph. It represents a possible ${level || "career"} direction with its own work settings, common tasks, vocabulary, learning demands, and fit signals. The learner does not need to compare it side by side with every other visible option inside this lesson. The useful question is simpler: what does this option mean, what kind of capability growth does it imply, and what evidence would make it worth selecting as the next path step?`;
  const competencyMaterial = hasCompetencies
    ? `For this option, the weighted competency evidence highlights: ${profileText}. Higher score means the competency appears more strongly across downstream jobs. Essential hits are stronger signals because they point to requirements that jobs more often treat as necessary, while optional hits suggest useful supporting knowledge or skills. Read these competencies as explanatory material: they show what the option tends to demand, what the learner may already recognize, and what learning gaps may appear after selection.`
    : `For this option, competency evidence is not available in the current graph payload. The learner can still study the option by identifying the main work domain, common outputs, people served, tools or knowledge areas, and the kind of learning effort it may require. If the option is later opened as an occupation or job, the weighted competency profile can add more precise evidence.`;
  return {
    growth_unit_id: `${level}:${firstText(option.code, option.uri, optionTitle)}:explanation`,
    reusable_key: `${level}:${firstText(option.code, option.uri, optionTitle)}:growth-unit`,
    title: `Full lesson: ${optionTitle}`,
    lesson_type: "full_lesson",
    card_type: hasCompetencies ? "full_competency_lesson" : "full_option_lesson",
    estimated_minutes: lengthGuide.target_minutes_per_card || 8,
    profile_adaptation: "This unit keeps the material explanatory and low-pressure. It uses the requested length bucket, the current path, and available graph evidence to help the learner understand this one option before selecting it.",
    target_decision_level: level,
    user_state_snapshot: `The learner is on the path ${pathText} and is considering ${optionTitle} as one possible next graph step.`,
    option_focus: {
      option_code: option.code || option.uri || optionTitle,
      option_title: optionTitle,
      option_level: option.level || level,
      option_uri: option.uri || ""
    },
    decision_question: `What should the learner understand about ${optionTitle} before selecting it?`,
    decision_context: `${optionTitle} is one selectable element in the current graph. This Growth Unit explains it on its own terms instead of turning the lesson into an option-by-option comparison. The learner should use the material to understand what the option points toward, what it may ask from them, and whether the next path step feels meaningful and realistic. The current path is ${pathText}.`,
    concept_focus: {
      concept_id: option.code || option.uri || "option-understanding",
      name: optionTitle,
      definition: option.description || conceptDefinition
    },
    learning_outcomes: [
      { description: `The learner can explain what ${optionTitle} means as a career-graph option.` },
      { description: `The learner can describe the main work patterns or learning demands connected to ${optionTitle}.` },
      { description: `The learner can identify whether ${optionTitle} has enough personal and graph evidence to select next.` }
    ],
    lesson_sections: [
      {
        section_type: "orientation",
        title: "Lesson orientation",
        content: `This lesson prepares the learner to understand ${optionTitle} as a complete career-graph learning object. The goal is not to rank it against other visible choices. The goal is to build enough meaning to decide whether this option deserves the next step in the Dynamic Learning Path. By the end, the learner should be able to describe the option, connect it to the current path, identify the main learning or competency demand, and make a grounded selection decision.`,
        estimated_minutes: 1
      },
      {
        section_type: "concept_teaching",
        title: `What ${optionTitle} means`,
        content: conceptDefinition,
        estimated_minutes: Math.max(1, Math.round((lengthGuide.target_minutes_per_card || 8) * 0.25))
      },
      {
        section_type: hasCompetencies ? "competency_teaching" : "concept_teaching",
        title: hasCompetencies ? "Competency signals to learn" : "Meaning signals to learn",
        content: competencyMaterial,
        estimated_minutes: Math.max(1, Math.round((lengthGuide.target_minutes_per_card || 8) * 0.25))
      },
      {
        section_type: "guided_practice",
        title: "Guided evidence note",
        content: `Create a short evidence note for ${optionTitle}. First, write the work or learning domain in plain language. Second, name the strongest connection to the learner's current goals, values, experience, or competencies. Third, name the biggest uncertainty. This turns the lesson into a decision-ready LMS activity: the learner is not just reading; they are producing a small artifact that shows whether the option is understandable and actionable.`,
        estimated_minutes: Math.max(1, Math.round((lengthGuide.target_minutes_per_card || 8) * 0.2))
      },
      {
        section_type: "summary",
        title: "Selection readiness summary",
        content: `The lesson is complete when the learner can explain ${optionTitle}, identify one important demand or competency pattern, and state whether the option should be selected now. If the explanation still feels vague, the learner should stay in the lesson and reread the concept and competency sections. If the evidence note is clear, the learner can return to the Decision Options panel and select this option if it fits.`,
        estimated_minutes: 1
      }
    ],
    practice_outcomes: [
      { description: `The learner can make a brief evidence note for or against selecting ${optionTitle}.` }
    ],
    micro_materials: [
      {
        material_type: "concept_explanation",
        title: "Read the option as a learning object",
        content: `Start by treating ${optionTitle} as a concept to understand, not a winner to rank. Ask what kind of work it points toward, what problems it usually addresses, what environments it may involve, and what learning it may require. This protects the learner from choosing only because a label sounds attractive. A strong next step should make the path clearer and should connect to goals, values, experience, or realistic learning capacity.`,
        focus_concept: optionTitle
      },
      {
        material_type: hasCompetencies ? "competency_explanation" : "option_concept_note",
        title: hasCompetencies ? "Top competency signals" : "Build meaning without competency evidence",
        content: competencyMaterial,
        focus_concept: hasCompetencies ? "weighted competencies" : "option meaning"
      },
      {
        material_type: "mini_exercise",
        title: "Evidence note",
        content: `Write a short note with three lines: what ${optionTitle} appears to involve, what part connects to the learner's profile, and what uncertainty remains. If the note is concrete, the option may be ready for selection. If the note is mostly vague, the learner should reread the explanation or inspect another option's Growth Unit before choosing from the Decision Options panel.`,
        focus_concept: "selection readiness"
      }
    ].slice(0, lengthGuide.micro_material_count || 3),
    reflection_questions: [
      `What is the clearest thing ${optionTitle} would add to the learner's path?`,
      `Which competency, work pattern, or learning demand matters most for ${optionTitle}?`,
      `What evidence would make selecting ${optionTitle} feel justified?`
    ],
    knowledge_checks: [
      {
        question: `In one sentence, what does ${optionTitle} mean as a career-graph option?`,
        expected_answer: `A clear answer names the work or learning direction behind ${optionTitle}, not only the label.`,
        feedback: "If the answer only repeats the title, return to the concept section and add work context, demands, or examples."
      },
      {
        question: hasCompetencies ? "Which top competency signal seems most important, and why?" : "Which meaning signal seems most important, and why?",
        expected_answer: hasCompetencies ? "A clear answer names one competency from the lesson and explains whether it is an essential or optional signal when available." : "A clear answer names one work pattern, output, tool, knowledge area, or learning demand from the lesson.",
        feedback: "If the answer is generic, connect it to the specific option and the learner's current path."
      }
    ],
    option_decision_guidance: [],
    lesson_completion_criteria: `The learner can explain ${optionTitle}, complete the evidence note, answer the checks, and decide whether selecting this option is justified.`,
    recommended_next_action: `Complete the full lesson, then select ${optionTitle} from the right-side Decision Options panel only if it fits the learner's goals and evidence.`
  };
}

function fallbackGrowthUnitDeck(payload, lengthGuide) {
  const normalizedOptions = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const level = payload.level || "decision";
  const pathText = payload.selectedPath && payload.selectedPath.length
    ? payload.selectedPath.map(function (item) { return item.title; }).join(" > ")
    : "starting from the broad career graph";
  return {
    deck_id: `${level}:local-growth-unit`,
    target_decision_level: level,
    decision_context: `Current path: ${pathText}`,
    options_available: normalizedOptions,
    length_guide: lengthGuide,
    generated_by: "local_fallback",
    growth_units: normalizedOptions.map(function (option) {
      return optionGrowthUnitFallback({
        option,
        level,
        pathText,
        lengthGuide,
        profile: matchingCompetencyProfile(option, payload.weighted_competency_profiles || payload.competencyProfiles)
      });
    })
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
  const minimumUnitCount = (payload.options || []).length ? Math.min(5, payload.options.length) : units.length;
  const normalizedUnits = units.slice();
  while (normalizedUnits.length < minimumUnitCount) {
    normalizedUnits.push(fallback.growth_units[normalizedUnits.length]);
  }
  return Object.assign({}, fallback, source, nestedDeck, {
    deck_id: source.deck_id || nestedDeck.deck_id || fallback.deck_id,
    target_decision_level: source.target_decision_level || nestedDeck.target_decision_level || fallback.target_decision_level,
    decision_context: source.decision_context || nestedDeck.decision_context || fallback.decision_context,
    options_available: source.options_available || nestedDeck.options_available || fallback.options_available,
    length_guide: source.length_guide || nestedDeck.length_guide || lengthGuide,
    growth_units: normalizedUnits.filter(Boolean).map(function (unit, index) {
      const fallbackUnit = fallback.growth_units[Math.min(index, fallback.growth_units.length - 1)];
      return Object.assign({}, fallbackUnit, unit, {
        growth_unit_id: unit.growth_unit_id || unit.id || `${source.deck_id || fallback.deck_id}:${index + 1}`,
        target_decision_level: unit.target_decision_level || payload.level || fallback.target_decision_level,
        estimated_minutes: unit.estimated_minutes || lengthGuide.target_minutes_per_card || fallbackUnit.estimated_minutes,
        learning_outcomes: Array.isArray(unit.learning_outcomes) && unit.learning_outcomes.length ? unit.learning_outcomes : fallbackUnit.learning_outcomes,
        lesson_sections: Array.isArray(unit.lesson_sections) && unit.lesson_sections.length ? unit.lesson_sections : fallbackUnit.lesson_sections,
        practice_outcomes: Array.isArray(unit.practice_outcomes) && unit.practice_outcomes.length ? unit.practice_outcomes : fallbackUnit.practice_outcomes,
        micro_materials: Array.isArray(unit.micro_materials) && unit.micro_materials.length ? unit.micro_materials : fallbackUnit.micro_materials,
        knowledge_checks: Array.isArray(unit.knowledge_checks) && unit.knowledge_checks.length ? unit.knowledge_checks : fallbackUnit.knowledge_checks,
        reflection_questions: Array.isArray(unit.reflection_questions) && unit.reflection_questions.length ? unit.reflection_questions : fallbackUnit.reflection_questions,
        lesson_completion_criteria: unit.lesson_completion_criteria || fallbackUnit.lesson_completion_criteria,
        recommended_next_action: unit.recommended_next_action || fallbackUnit.recommended_next_action
      });
    })
  });
}

function fallbackCompetencyGrowthUnitDeck(payload, lengthGuide) {
  const node = normalizeGraphOption(payload.highlightedNode || payload.highlighted_node || payload.node);
  const competency = normalizeCompetencyOption(payload.selectedCompetency || payload.selected_competency || payload.competency);
  const userCompetencyLevel = normalizeCompetencyLevel(payload);
  const levelLabel = competencyLevelLabel(userCompetencyLevel);
  const canGenerate = isKnowledgeCompetency(competency);
  const competencyTitle = competency.title || "the selected knowledge competency";
  const nodeTitle = node.title || "the highlighted occupation/job";
  const minutes = lengthGuide.target_minutes_per_card || 8;
  return {
    deck_id: `${firstText(node.code, "node")}:${firstText(competency.code, "competency")}:knowledge-growth-unit`,
    deck_type: "competency_growth_unit",
    can_generate: canGenerate,
    generation_note: canGenerate
      ? "Local fallback generated for a Knowledge type competency."
      : "Competency Growth Units are generated only for Knowledge type competencies.",
    highlighted_node: node,
    selected_competency: competency,
    user_competency_level_1_to_5: userCompetencyLevel,
    level_interpretation: `Learner is at ${levelLabel} level for this knowledge area.`,
    length_guide: lengthGuide,
    generated_by: "local_fallback",
    growth_units: canGenerate ? [
      {
        growth_unit_id: `${firstText(competency.code, "knowledge")}:concept-foundation`,
        reusable_key: `${firstText(competency.code, "knowledge")}:competency-growth`,
        title: `Understand ${competencyTitle}`,
        lesson_type: "full_lesson",
        card_type: "full_competency_lesson",
        estimated_minutes: minutes,
        profile_adaptation: `This card is adapted for a learner at level ${userCompetencyLevel} (${levelLabel}) in this knowledge area. It keeps the explanation concrete, connects the knowledge to ${nodeTitle}, and avoids turning the content into a career-choice recommendation.`,
        target_node_level: node.level || "occupation_or_job",
        user_state_snapshot: `The learner is inspecting ${nodeTitle} and has highlighted ${competencyTitle} from the weighted competency profile.`,
        competency_question: `What does the learner need to understand about ${competencyTitle} to see why it matters for ${nodeTitle}?`,
        knowledge_context: `${competencyTitle} appears in the weighted competency profile for ${nodeTitle}. Its graph evidence suggests relevance across ${competency.job_count || 0} downstream jobs, with ${competency.essential_hits || 0} essential hits and ${competency.optional_hits || 0} optional hits. The purpose of this Growth Unit is not to decide whether the learner should choose the occupation or job. Its purpose is to build useful knowledge about the competency so the learner can interpret the role requirements with more confidence.`,
        competency_focus: {
          competency_id: competency.code || competency.uri || "knowledge-competency",
          name: competencyTitle,
          type: "Knowledge",
          definition: competency.description || `${competencyTitle} is a knowledge area that helps the learner understand concepts, vocabulary, principles, and patterns used in ${nodeTitle}.`,
          why_it_matters_for_node: `This knowledge helps the learner interpret tasks, requirements, and learning gaps connected to ${nodeTitle}.`
        },
        current_level_fit: {
          level: userCompetencyLevel,
          level_label: levelLabel,
          what_the_learner_likely_knows: userCompetencyLevel <= 2
            ? "The learner may recognize the term but still needs basic vocabulary, examples, and boundaries."
            : "The learner likely has some usable understanding and needs clearer patterns, mistakes, and transfer examples.",
          next_understanding_step: userCompetencyLevel >= 4
            ? "Refine the concept into a teachable mental model and connect it to nuanced role situations."
            : "Build a stable definition, recognize common examples, and identify one practical knowledge gap."
        },
        learning_outcomes: [
          { description: `The learner can explain ${competencyTitle} in their own words.` },
          { description: `The learner can describe why ${competencyTitle} matters for ${nodeTitle}.` },
          { description: "The learner can identify one next knowledge gap to strengthen." }
        ],
        knowledge_practice_outcomes: [
          { description: "The learner can complete a short self-check that separates familiar terms from concepts they can explain." }
        ],
        lesson_sections: [
          {
            section_type: "orientation",
            title: "Why this knowledge is here",
            content: `${competencyTitle} is being taught because it appears as evidence inside the weighted competency profile for ${nodeTitle}. Treat this lesson as preparation for understanding the role context, not as a recommendation to choose the role. The learner should leave with a clearer definition, a concrete example, and a better sense of the next knowledge gap.`,
            estimated_minutes: Math.max(1, Math.round(minutes * 0.2)),
            focus_concept: "role-relevant knowledge"
          },
          {
            section_type: "concept_teaching",
            title: "Build the core meaning",
            content: `Start by defining ${competencyTitle} as a knowledge area, not as a task. Knowledge means the learner understands concepts, vocabulary, relationships, principles, and common situations. At level ${userCompetencyLevel}, the useful first move is to separate recognition from explanation. If the learner only recognizes the label, they should focus on plain-language meaning and examples. If they can already explain it, they should focus on where the concept becomes important in ${nodeTitle}.`,
            estimated_minutes: Math.max(1, Math.round(minutes * 0.25)),
            focus_concept: competencyTitle
          },
          {
            section_type: "worked_example",
            title: "Connect it to the role context",
            content: `In ${nodeTitle}, ${competencyTitle} matters because it helps the learner interpret what the work expects before they judge fit. The weighted profile points to this competency through sources such as ${(competency.sources || []).slice(0, 3).join(", ") || "downstream job requirements"}. Read that evidence as a relevance signal: the knowledge appears often enough that understanding it can make later learning and role comparison more precise.`,
            estimated_minutes: Math.max(1, Math.round(minutes * 0.25)),
            focus_concept: "role relevance"
          },
          {
            section_type: "guided_practice",
            title: "Check current understanding",
            content: `Write three short statements: one definition of ${competencyTitle}, one example of where it appears in ${nodeTitle}, and one question you still cannot answer. If the definition is vague, stay with basic vocabulary. If the example is missing, look for work situations connected to the highlighted role. If the question is specific, the learner is ready for a deeper lesson or the next competency.`,
            estimated_minutes: Math.max(1, Math.round(minutes * 0.2)),
            focus_concept: "knowledge confidence"
          },
          {
            section_type: "summary",
            title: "What good enough looks like",
            content: `The lesson is complete when the learner can explain ${competencyTitle} without only repeating the title, name one place it matters in ${nodeTitle}, and identify one next concept or term to learn. That is enough progress for this competency Growth Unit.`,
            estimated_minutes: Math.max(1, Math.round(minutes * 0.1)),
            focus_concept: "completion"
          }
        ],
        micro_materials: [
          {
            material_type: "knowledge_explanation",
            title: "Build the core meaning",
            content: `Start by defining ${competencyTitle} as a knowledge area, not as a task. Knowledge means the learner understands concepts, vocabulary, relationships, principles, and common situations. At level ${userCompetencyLevel}, the useful first move is to separate recognition from explanation. If the learner only recognizes the label, they should focus on plain-language meaning and examples. If they can already explain it, they should focus on where the concept becomes important in ${nodeTitle}.`,
            focus_concept: competencyTitle
          },
          {
            material_type: "worked_example",
            title: "Connect it to the role context",
            content: `In ${nodeTitle}, ${competencyTitle} matters because it helps the learner interpret what the work expects before they judge fit. The weighted profile points to this competency through sources such as ${(competency.sources || []).slice(0, 3).join(", ") || "downstream job requirements"}. Read that evidence as a relevance signal: the knowledge appears often enough that understanding it can make later learning and role comparison more precise.`,
            focus_concept: "role relevance"
          },
          {
            material_type: "self_check",
            title: "Check current understanding",
            content: `Write three short statements: one definition of ${competencyTitle}, one example of where it appears in ${nodeTitle}, and one question you still cannot answer. If the definition is vague, stay with basic vocabulary. If the example is missing, look for work situations connected to the highlighted role. If the question is specific, the learner is ready for a deeper card or the next competency.`,
            focus_concept: "knowledge confidence"
          }
        ],
        reflection_questions: [
          `What part of ${competencyTitle} is already clear at level ${userCompetencyLevel}?`,
          `Where would this knowledge show up inside ${nodeTitle}?`,
          "What is the smallest knowledge gap to close next?"
        ],
        knowledge_checks: [
          {
            question: `What is the difference between recognizing the term ${competencyTitle} and understanding it well enough to use it?`,
            expected_answer: "A strong answer explains the concept in plain language, gives a role-relevant example, and names one boundary or uncertainty.",
            feedback: "If the answer only repeats the competency title, return to the concept section and build a more concrete definition."
          },
          {
            question: `Why does ${competencyTitle} matter for ${nodeTitle}?`,
            expected_answer: "A strong answer connects the competency to tasks, requirements, learning gaps, or downstream job evidence without treating it as a recommendation.",
            feedback: "Use the weighted evidence as relevance context, then explain the work situation in ordinary language."
          }
        ],
        lesson_completion_criteria: `The learner can explain ${competencyTitle}, connect it to ${nodeTitle}, complete the knowledge check, and name one next knowledge gap.`,
        recommended_next_action: "Review the knowledge card, mark confidence for this competency, then return to the highlighted occupation/job competency list."
      }
    ] : []
  };
}

function normalizeCompetencyGrowthUnitDeck(result, payload, lengthGuide) {
  const fallback = fallbackCompetencyGrowthUnitDeck(payload, lengthGuide);
  if (!result) return fallback;
  const source = Array.isArray(result) ? { growth_units: result } : result;
  const nestedDeck = source.deck || source.competency_growth_unit_deck || source.competencyGrowthUnitDeck || {};
  const units = source.growth_units ||
    source.growthUnits ||
    source.units ||
    source.cards ||
    nestedDeck.growth_units ||
    nestedDeck.growthUnits ||
    nestedDeck.units ||
    nestedDeck.cards;
  const canGenerate = booleanFromValue(source.can_generate, fallback.can_generate);
  return Object.assign({}, fallback, source, nestedDeck, {
    deck_id: source.deck_id || nestedDeck.deck_id || fallback.deck_id,
    deck_type: "competency_growth_unit",
    can_generate: canGenerate,
    generation_note: source.generation_note || nestedDeck.generation_note || fallback.generation_note,
    highlighted_node: source.highlighted_node || nestedDeck.highlighted_node || fallback.highlighted_node,
    selected_competency: source.selected_competency || nestedDeck.selected_competency || fallback.selected_competency,
    user_competency_level_1_to_5: source.user_competency_level_1_to_5 || nestedDeck.user_competency_level_1_to_5 || fallback.user_competency_level_1_to_5,
    length_guide: source.length_guide || nestedDeck.length_guide || lengthGuide,
    growth_units: Array.isArray(units) && units.length ? units.map(function (unit, index) {
      const fallbackUnit = fallback.growth_units[Math.min(index, Math.max(0, fallback.growth_units.length - 1))] || {};
      return Object.assign({}, fallbackUnit, unit, {
        growth_unit_id: unit.growth_unit_id || unit.id || `${fallback.deck_id}:${index + 1}`,
        lesson_type: unit.lesson_type || fallbackUnit.lesson_type || "full_lesson",
        card_type: unit.card_type || fallbackUnit.card_type || "full_competency_lesson",
        estimated_minutes: unit.estimated_minutes || lengthGuide.target_minutes_per_card || fallbackUnit.estimated_minutes,
        learning_outcomes: Array.isArray(unit.learning_outcomes) && unit.learning_outcomes.length ? unit.learning_outcomes : fallbackUnit.learning_outcomes,
        knowledge_practice_outcomes: Array.isArray(unit.knowledge_practice_outcomes) && unit.knowledge_practice_outcomes.length ? unit.knowledge_practice_outcomes : fallbackUnit.knowledge_practice_outcomes,
        lesson_sections: Array.isArray(unit.lesson_sections) && unit.lesson_sections.length ? unit.lesson_sections : fallbackUnit.lesson_sections,
        micro_materials: Array.isArray(unit.micro_materials) && unit.micro_materials.length ? unit.micro_materials : fallbackUnit.micro_materials,
        knowledge_checks: Array.isArray(unit.knowledge_checks) && unit.knowledge_checks.length ? unit.knowledge_checks : fallbackUnit.knowledge_checks,
        reflection_questions: Array.isArray(unit.reflection_questions) && unit.reflection_questions.length ? unit.reflection_questions : fallbackUnit.reflection_questions,
        lesson_completion_criteria: unit.lesson_completion_criteria || fallbackUnit.lesson_completion_criteria,
        recommended_next_action: unit.recommended_next_action || fallbackUnit.recommended_next_action
      });
    }) : fallback.growth_units
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

function optionGrowthUnitCacheKey(option, level, lengthGuide) {
  return learningMaterialCacheKey([
    "growth_unit",
    "option",
    level || option.level || "decision",
    graphNodeKey(option, "option"),
    lengthGuide.length_bucket || lengthGuide.requested_length
  ]);
}

function competencyGrowthUnitCacheKey(node, competency, lengthGuide) {
  return learningMaterialCacheKey([
    "growth_unit",
    "competency",
    graphNodeKey(node, "node"),
    graphNodeKey(competency, "competency"),
    lengthGuide.length_bucket || lengthGuide.requested_length
  ]);
}

async function getCachedOptionGrowthUnits(payload, lengthGuide) {
  if (!driver) return new Map();
  const level = payload.level || "decision";
  const options = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const entries = await Promise.all(options.map(async function (option) {
    const cacheKey = optionGrowthUnitCacheKey(option, level, lengthGuide);
    try {
      const rows = await readQuery(`
        MATCH (target)-[:HAS_LEARNING_MATERIAL]->(material:LearningMaterial {cache_key: $cacheKey})
        WHERE target:Sector OR target:Occupation OR target:Job
        RETURN material.payload_json AS payloadJson,
               material.updated_at AS updatedAt,
               material.length_bucket AS lengthBucket
        ORDER BY material.updated_at DESC
        LIMIT 1
      `, { cacheKey });
      const unit = parseJsonProperty(rows[0] && rows[0].payloadJson, null);
      return unit ? [cacheKey, Object.assign({}, unit, {
        cache_status: "neo4j_cache",
        cached_at: rows[0].updatedAt
      })] : null;
    } catch (error) {
      console.warn(`Learning material cache read failed for ${cacheKey}: ${error.message}`);
      return null;
    }
  }));
  return new Map(entries.filter(Boolean));
}

async function saveOptionGrowthUnits(deck, payload, lengthGuide) {
  if (!driver || !deck || !Array.isArray(deck.growth_units)) return;
  const level = payload.level || deck.target_decision_level || "decision";
  const options = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const now = new Date().toISOString();
  await Promise.all(deck.growth_units.slice(0, options.length).map(async function (unit, index) {
    const option = options[index];
    if (!option) return;
    const cacheKey = optionGrowthUnitCacheKey(option, level, lengthGuide);
    const payloadJson = JSON.stringify(Object.assign({}, unit, {
      cached_for: {
        material_type: "option_growth_unit",
        target_level: level,
        target_code: option.code || "",
        target_uri: option.uri || "",
        length_bucket: lengthGuide.length_bucket
      }
    }));
    try {
      await writeQuery(`
        MATCH (target)
        WHERE (target.uri = $targetUri OR target.Code = $targetCode)
          AND (target:Sector OR target:Occupation OR target:Job)
        MERGE (material:LearningMaterial {cache_key: $cacheKey})
        SET material.material_type = "option_growth_unit",
            material.target_level = $targetLevel,
            material.target_code = $targetCode,
            material.target_uri = $targetUri,
            material.length_bucket = $lengthBucket,
            material.requested_length = $requestedLength,
            material.title = $title,
            material.payload_json = $payloadJson,
            material.updated_at = $now,
            material.created_at = coalesce(material.created_at, $now)
        MERGE (target)-[:HAS_LEARNING_MATERIAL]->(material)
        RETURN material.cache_key AS cache_key
      `, {
        cacheKey,
        targetLevel: level,
        targetCode: option.code || "",
        targetUri: option.uri || "",
        lengthBucket: lengthGuide.length_bucket || "",
        requestedLength: lengthGuide.requested_length || "",
        title: unit.title || option.title || "",
        payloadJson,
        now
      });
    } catch (error) {
      console.warn(`Learning material cache write failed for ${cacheKey}: ${error.message}`);
    }
  }));
}

function cachedOptionGrowthUnitDeck(payload, lengthGuide, cachedUnits, generatedBy) {
  const fallback = fallbackGrowthUnitDeck(payload, lengthGuide);
  const level = payload.level || fallback.target_decision_level || "decision";
  const options = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  return Object.assign({}, fallback, {
    deck_id: `${level}:${lengthGuide.length_bucket || "length"}:cached-growth-unit`,
    generated_by: generatedBy || "neo4j_cache",
    cache_status: generatedBy || "neo4j_cache",
    growth_units: options.map(function (option, index) {
      const cacheKey = optionGrowthUnitCacheKey(option, level, lengthGuide);
      return cachedUnits.get(cacheKey) || fallback.growth_units[index];
    })
  });
}

async function getCachedCompetencyGrowthUnit(payload, lengthGuide) {
  if (!driver) return null;
  const node = normalizeGraphOption(payload.highlightedNode || payload.highlighted_node || payload.node);
  const competency = normalizeCompetencyOption(payload.selectedCompetency || payload.selected_competency || payload.competency);
  const cacheKey = competencyGrowthUnitCacheKey(node, competency, lengthGuide);
  try {
    const rows = await readQuery(`
      MATCH (target)-[:HAS_CONTEXTUAL_LEARNING_MATERIAL]->(material:LearningMaterial {cache_key: $cacheKey})
      MATCH (competency)-[:HAS_LEARNING_MATERIAL]->(material)
      WHERE (target:Occupation OR target:Job)
        AND (competency:Competency OR competency:GH_Competency)
      RETURN material.payload_json AS payloadJson,
             material.updated_at AS updatedAt
      ORDER BY material.updated_at DESC
      LIMIT 1
    `, { cacheKey });
    const deck = parseJsonProperty(rows[0] && rows[0].payloadJson, null);
    return deck ? cacheGeneratedBy(Object.assign({}, deck, { cached_at: rows[0].updatedAt }), "neo4j_cache") : null;
  } catch (error) {
    console.warn(`Competency learning material cache read failed for ${cacheKey}: ${error.message}`);
    return null;
  }
}

async function saveCompetencyGrowthUnit(deck, payload, lengthGuide) {
  if (!driver || !deck) return;
  const node = normalizeGraphOption(payload.highlightedNode || payload.highlighted_node || payload.node);
  const competency = normalizeCompetencyOption(payload.selectedCompetency || payload.selected_competency || payload.competency);
  const cacheKey = competencyGrowthUnitCacheKey(node, competency, lengthGuide);
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(Object.assign({}, deck, {
    cached_for: {
      material_type: "competency_growth_unit",
      highlighted_node_code: node.code || "",
      highlighted_node_uri: node.uri || "",
      competency_code: competency.code || "",
      competency_uri: competency.uri || "",
      length_bucket: lengthGuide.length_bucket
    }
  }));
  try {
    await writeQuery(`
      MATCH (target)
      WHERE (target.uri = $targetUri OR target.Code = $targetCode)
        AND (target:Occupation OR target:Job)
      MATCH (competency)
      WHERE (competency.uri = $competencyUri OR competency.Code = $competencyCode)
        AND (competency:Competency OR competency:GH_Competency)
      MERGE (material:LearningMaterial {cache_key: $cacheKey})
      SET material.material_type = "competency_growth_unit",
          material.target_code = $targetCode,
          material.target_uri = $targetUri,
          material.competency_code = $competencyCode,
          material.competency_uri = $competencyUri,
          material.length_bucket = $lengthBucket,
          material.requested_length = $requestedLength,
          material.title = $title,
          material.payload_json = $payloadJson,
          material.updated_at = $now,
          material.created_at = coalesce(material.created_at, $now)
      MERGE (target)-[:HAS_CONTEXTUAL_LEARNING_MATERIAL]->(material)
      MERGE (competency)-[:HAS_LEARNING_MATERIAL]->(material)
      RETURN material.cache_key AS cache_key
    `, {
      cacheKey,
      targetCode: node.code || "",
      targetUri: node.uri || "",
      competencyCode: competency.code || "",
      competencyUri: competency.uri || "",
      lengthBucket: lengthGuide.length_bucket || "",
      requestedLength: lengthGuide.requested_length || "",
      title: deck.growth_units && deck.growth_units[0] ? deck.growth_units[0].title : competency.title || "",
      payloadJson,
      now
    });
  } catch (error) {
    console.warn(`Competency learning material cache write failed for ${cacheKey}: ${error.message}`);
  }
}

async function growthUnit(payload) {
  if (!payload.options || !payload.options.length) {
    throw serviceError("No current graph options are available. A Growth Unit lesson deck cannot be generated.", 422);
  }
  const lengthGuide = growthUnitLengthGuide(payload);
  const normalizedOptions = (payload.options || []).map(normalizeGraphOption).slice(0, 5);
  const cachedUnits = await getCachedOptionGrowthUnits(Object.assign({}, payload, { options: normalizedOptions }), lengthGuide);
  const level = payload.level || "decision";
  const missingOptions = normalizedOptions.filter(function (option) {
    return !cachedUnits.has(optionGrowthUnitCacheKey(option, level, lengthGuide));
  });

  if (!missingOptions.length && normalizedOptions.length) {
    return cachedOptionGrowthUnitDeck(Object.assign({}, payload, { options: normalizedOptions }), lengthGuide, cachedUnits, "neo4j_cache");
  }

  const generationPayload = Object.assign({}, payload, { options: missingOptions });
  const competencyProfiles = await buildGrowthUnitCompetencyProfiles(generationPayload);
  const enrichedPayload = Object.assign({}, generationPayload, {
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
  const generatedDeck = normalizeGrowthUnitDeck(result, enrichedPayload, lengthGuide);
  await saveOptionGrowthUnits(generatedDeck, enrichedPayload, lengthGuide);

  generatedDeck.growth_units.forEach(function (unit, index) {
    const option = missingOptions[index];
    if (!option) return;
    cachedUnits.set(optionGrowthUnitCacheKey(option, level, lengthGuide), unit);
  });

  return cachedOptionGrowthUnitDeck(
    Object.assign({}, payload, { options: normalizedOptions }),
    lengthGuide,
    cachedUnits,
    cachedUnits.size === missingOptions.length ? "generated_and_cached" : "neo4j_cache_mixed"
  );
}

async function competencyGrowthUnit(payload) {
  const highlightedNode = payload.highlightedNode || payload.highlighted_node || payload.node;
  const selectedCompetency = payload.selectedCompetency || payload.selected_competency || payload.competency;
  if (!highlightedNode) {
    throw serviceError("A highlighted occupation/job node is required for competency Growth Unit generation.", 400);
  }
  if (!selectedCompetency) {
    throw serviceError("A selected Knowledge competency is required for competency Growth Unit generation.", 400);
  }
  const userCompetencyLevel = normalizeCompetencyLevel(payload);
  const lengthGuide = competencyGrowthUnitLengthGuide(payload);
  const enrichedPayload = Object.assign({}, payload, {
    highlightedNode: normalizeGraphOption(highlightedNode),
    highlighted_node: normalizeGraphOption(highlightedNode),
    selectedCompetency: normalizeCompetencyOption(selectedCompetency),
    selected_competency: normalizeCompetencyOption(selectedCompetency),
    user_competency_level_1_to_5: userCompetencyLevel
  });
  const fallback = fallbackCompetencyGrowthUnitDeck(enrichedPayload, lengthGuide);
  if (!isKnowledgeCompetency(enrichedPayload.selectedCompetency)) {
    return fallback;
  }
  const cachedDeck = await getCachedCompetencyGrowthUnit(enrichedPayload, lengthGuide);
  if (cachedDeck) return cachedDeck;

  const shape = competencyGrowthUnitDeckShape({
    highlightedNode: enrichedPayload.highlightedNode,
    selectedCompetency: enrichedPayload.selectedCompetency,
    userCompetencyLevel,
    lengthGuide
  });
  const prompt = createCompetencyGrowthUnitPrompt({
    shape,
    lengthGuide,
    enrichedPayload,
    profileSignal: profileSignal(payload.profile)
  });
  const result = await askGemini(prompt, fallback);
  const deck = normalizeCompetencyGrowthUnitDeck(result, enrichedPayload, lengthGuide);
  await saveCompetencyGrowthUnit(deck, enrichedPayload, lengthGuide);
  return cacheGeneratedBy(deck, "generated_and_cached");
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

app.post("/api/gemini/competency-growth-unit", async (req, res, next) => {
  try { res.json(await competencyGrowthUnit(req.body)); } catch (error) { next(error); }
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
