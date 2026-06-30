# GapHopper LMS Demo

This is a React/Vite demo application for exploring career directions from a user profile. It uses an Express backend to keep Neo4j and Gemini credentials out of the browser.

The app requires both services to generate recommendations:

- Neo4j provides graph options for sectors, occupations, jobs, and competencies.
- Gemini ranks options, generates chat answers, and creates Growth Units.

If Neo4j or Gemini is not available, the app shows a warning and does not generate suggestions or Growth Units.

## What The App Does

1. Paste or upload a `user_profile_analysis` JSON.
2. Review the parsed profile summary.
3. View the current graph position:
   - Sector
   - Occupation level 1
   - Occupation level 2
   - Occupation level 3
   - Occupation level 4
   - Job
4. Use the compact decision options as inputs for the current step.
5. Generate a central Growth Unit to help understand the decision, compare options, and choose the next graph path step.
6. Use the coach chat to discuss the Growth Unit or the current decision.

The default profile is loaded from:

```text
docs/user_profile_mock_1.json
```

The expected profile structure is documented in:

```text
docs/user_profile_schema.json
```

## Prerequisites

Use Node.js and npm.

This project currently uses dependency versions that work with the local Node 12 environment in this workspace. A newer Node LTS version is still recommended for future development, but changing Node versions may require updating the pinned dependencies in `package.json`.

## Install Dependencies

From the project root:

```bash
npm install
```

## Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=8787
```

If Neo4j values or `GEMINI_API_KEY` are missing, the app still starts, but generation is disabled and the UI warns which service is unavailable.

`GEMINI_MODEL` is optional. If it is not set, the backend defaults to `gemini-2.5-flash-lite` and can retry other Flash models when Google reports that a model is not available for `generateContent`.

## Start The App

Run both the Express API and Vite frontend:profiles

```bash
npm run dev
```

Open the frontend:

```text
http://localhost:5173/
```

The backend API runs here:

```text
http://localhost:8787
```

If port `8787` is already in use, change the backend port in `.env`:

```bash
PORT=8788
```

Then restart:

```bash
npm run dev
```

The Vite dev server reads the same `PORT` value and proxies `/api/...` requests to that backend port.

## Check Service Status

In the app, the status bar shows whether Neo4j and Gemini are configured.

You can also check the API directly:

```bash
curl http://localhost:8787/api/status
```

Example response when services are not available:

```json
{
  "neo4jConfigured": false,
  "neo4jConnected": false,
  "geminiConfigured": false,
  "geminiAvailable": false
}
```

## Learning Material Storage

Generated Growth Unit lessons are cached in Neo4j as `LearningMaterial` nodes. The cache key includes the graph target and the normalized lesson length bucket (`<2min`, `2-5min`, `5-10min`, `10-20min`, or `>20min`).

- Option Growth Units connect from the sector, occupation, or job with `(:Sector|Occupation|Job)-[:HAS_LEARNING_MATERIAL]->(:LearningMaterial)`.
- Competency Growth Units connect from the highlighted occupation/job with `[:HAS_CONTEXTUAL_LEARNING_MATERIAL]` and from the selected competency with `(:Competency|GH_Competency)-[:HAS_LEARNING_MATERIAL]->(:LearningMaterial)`.
- When the same target and length bucket are requested again, the backend returns the stored material from Neo4j instead of calling Gemini.

## Build For Production

To verify the frontend build:

```bash
npm run build
```

The built files are written to:

```text
dist/
```

## Main Files

- `src/main.jsx`: React app and UI components.
- `src/styles.css`: Application styling.
- `server/index.js`: Express API, Neo4j queries, and Gemini integration.
- `.env.example`: Required environment variable names.
- `docs/user_profile_mock_1.json`: Default sample user profile.
- `docs/user_profile_schema.json`: Expected user profile structure.

## Notes

- Neo4j credentials and the Gemini API key are only read by the backend.
- The frontend calls `/api/...`; Vite proxies those requests to the Express server during development.
- If Neo4j is unavailable, graph endpoints return an error and no suggestions are generated.
- If Gemini is unavailable, AI endpoints return an error and no suggestions, chat answers, or Growth Units are generated.
# gh_lms
