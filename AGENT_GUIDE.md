# Agent Guide

This document exists so future Codex agents and contributors can orient themselves quickly when working on LegalGenie.

## Read First
- Skim `README.md` to remember how to start the stack and which ports are used.
- Look for TODO comments or open issues that might affect your task.
- Compare your local `.env` files with the checked-in `.env.example` templates so you pick up new variables.

## Environment Expectations
- Node.js 20 LTS, npm 9+, Python 3.11+, Docker Desktop, and optionally Conda for the NER environment.
- Postgres 15 normally runs through Docker Compose. Local installs are fine as long as the database name, user, and password match the defaults.
- Hugging Face models live on disk; `PIPELINE_MODEL_PATH` should point to the folder that contains `config.json`.
- Neo4j is optional, but when enabled it is expected at `bolt://localhost:7687` with credentials provided in `api/.env`.

## Standard Workflow for a Change
1. **Map the blast radius**: decide whether the work touches the API (`api/`), the web app (`web/`), the pipeline (`lg_pipeline/`), or multiple pieces.
2. **Keep tests in sync**:
   - UI: `npm --prefix web run lint` (add component tests when they exist).
   - API: add targeted scripts in `api/package.json` when you introduce tests; run them before shipping.
   - Pipeline: `pytest` inside `lg_pipeline` for fast regression checks.
3. **Run the impacted services**: `npm run dev:api`, `npm run dev:web`, `npm run dev:pipeline`, or bring everything up with `npm run dev:all` or `docker compose up`.
4. **Validate the change**: hit the affected endpoints, interact with the UI, or run a sample ingestion as needed.
5. **Document the result**:
   - Update `README.md` if setup, ports, or workflows moved.
   - Capture API contract updates near the code (for example `api/docs/`) and link from the README.
   - Mirror any new configuration values into the `.env.example` files with a short description.
6. **Note migrations**: if the database schema changes, add a short checklist next to the migration files and reference it in the README.

## Coding Conventions
- React code uses modern TypeScript-style imports and functional components; lint before you hand off.
- The API sticks to modern ECMAScript (ESM modules, async/await) and organised controllers/services.
- Python code should remain PEP 8 compliant; if you add formatters such as `ruff` or `black`, document the commands here.
- Comments should explain intent, not line-by-line behaviour.

## Testing and Verification Checklist
- UI change: record expected behaviour (gif or bullet notes) for reviewers.
- API change: save the request/response example you used for manual testing.
- Pipeline change: run one end-to-end ingestion and keep the generated `retrieved.txt` until review is done.
- Docker change: rebuild the affected service (`docker compose build <service>`) and confirm it starts cleanly.

## Hand-Off Expectations
- Mention feature flags, environment switches, or seeds a reviewer must enable.
- Remove temporary scripts or data, or clearly state why they should stay.
- Update this guide whenever the workflow changes so the next agent can rely on it.

## Quick Reference
- `README.md` - newcomer setup and day-to-day runbook.
- `lg_pipeline/README.md` - deep dive into ingestion and retrieval internals.
- `docker-compose.yml` - authoritative list of services, ports, and shared volumes.
- `uploads.js` - helper script to seed uploads for demos or tests.

Keep notes current. A few minutes updating this file saves hours for the next person.
