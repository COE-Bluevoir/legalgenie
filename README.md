# LegalGenie

LegalGenie is a legal research assistant you can run on your own machine. It bundles three pieces that talk to each other:
- a Node.js API that stores cases, files, chat history, and runs ingestion jobs
- a React website where you upload documents and chat with the assistant
- a Python pipeline that turns uploaded files into searchable knowledge (chunks, vectors, entities, Neo4j graph data)

This guide keeps the language plain so a new teammate can get the stack going without digging through the code first.

## Before You Begin
Make sure the following tools are installed and available in your terminal or PowerShell window:
- Docker Desktop (includes Docker Compose) if you want the all-in-one container setup
- Node.js 18 or newer (Node 20 LTS recommended) and npm 9+
- Python 3.11 or newer for the ingestion pipeline
- (Optional) Conda if you plan to run the spaCy NER environment separately
- (Optional) A GPU-friendly Python install if you want to speed up embeddings

## One-Time File Preparation
1. Copy each example environment file and adjust the copies:
   - `cp api/.env.example api/.env`
   - `cp web/.env.example web/.env`
   - If you run the Python pipeline outside Docker, create `lg_pipeline/.env` with your local paths (see that folder's README for details).
2. Update the new `.env` files with real secrets and paths:
   - Pick a strong `JWT_SECRET` and admin password in `api/.env`.
   - Point `PIPELINE_MODEL_PATH` to the folder that contains your local Hugging Face embedding model's `config.json`.
   - Set the Neo4j URL, username, and password if you are using graph features.

> Tip: Keep `.env` files out of version control. They are already ignored by `.gitignore`.

## Quick Start (Docker, easiest)
Run everything in containers if you have Docker Desktop running:
1. From the project root run: `docker compose up --build`
2. Wait for the logs to settle. The first build can take a few minutes while the Python image downloads models and wheels.
3. Open the services once the build finishes:
   - API: http://localhost:8787
   - Web: http://localhost:5173
   - Pipeline service (FastAPI): http://localhost:8000/docs for a quick health check
   - Postgres database: exposed on `localhost:5432`
4. Use `docker compose down` to stop the stack. Add `-v` if you want to clear the Postgres and uploads volumes.

## Manual Start (run each service yourself)
If you prefer to run things locally without Docker:
1. Install dependencies once:
   - `npm install` (root helper scripts)
   - `npm install --prefix api`
   - `npm install --prefix web`
   - `pip install -r lg_pipeline/requirements.txt`
2. Start every service in one command: `npm run dev:all`
   - This runs the API on port 8787, the React app on 5173, and the pipeline FastAPI on 8000.
3. Want finer control? Use the individual scripts instead:
   - API only: `npm run dev:api`
   - Web only: `npm run dev:web`
   - Pipeline only: `npm run dev:pipeline`
   - Postgres via Docker: `npm run dev:db`

Uploads saved by the API land in `api/data/uploads/`. The Python pipeline reads from the same folder when it ingests files.

## What to Expect After Startup
- Visit http://localhost:5173 to use the LegalGenie interface.
- Default admin login (change it in `.env`): `admin@legalgenie.dev` / `ChangeMe!123`.
- Upload a document in the Research area to trigger ingestion jobs.
- The Admin tab exposes ingestion runs, chunk previews, and Neo4j entity coverage.

## Common Developer Tasks
- **Database migrations**: run `npm --prefix api run db:migrate`.
- **Rebuild containers after code changes**: `docker compose build api web pipeline` then `docker compose up -d`.
- **Reset local data quickly**: stop services, delete `api/data/uploads/` and the `.chroma` folder, then restart.
- **Check pipeline health**: visit http://localhost:8000/health or run `pytest` inside `lg_pipeline`.

## Project Tour
- `api/` - Express server, database access layer, ingestion webhooks, auth, and admin endpoints.
- `web/` - React + Vite UI with Tailwind styling and Radix UI components.
- `lg_pipeline/` - Python CLI and FastAPI service for OCR, chunking, embeddings, NER, and retrieval. See its README for advanced usage.
- `docker-compose.yml` - Brings up Postgres, API, pipeline, and web UI in one shot.
- `uploads.js` - Helper script for seeding uploads directly if you need test data.

## Troubleshooting Basics
- **Ports already in use**: stop any old processes (`stop-process -id <pid>` in PowerShell) or change the ports in the `.env` files.
- **Pipeline cannot find the model**: confirm `PIPELINE_MODEL_PATH` points to the folder that actually contains `config.json`.
- **Neo4j errors**: ensure your Neo4j server is running and the credentials match `PIPELINE_NEO4J_*` values.
- **Docker build keeps failing on Python wheels**: try `docker compose build --no-cache pipeline` after clearing your Docker cache.

## When You Change Things
- Update this README whenever setup steps, scripts, or ports change.
- Record API contract changes in `api/README.md` or a new docs file and link it here.
- Keep `.env.example` files aligned with any new variables so newcomers copy the right template.

## More Documentation
- Detailed pipeline walkthrough: `lg_pipeline/README.md`
- Future contributor playbook (what Codex or another agent should read first): `AGENT_GUIDE.md`
- Want to extend the UI? Check the component structure in `web/src/` and run `npm --prefix web run lint` before opening a PR.

Happy hacking! Keep improvements and troubleshooting notes in this README so the next person can get started even faster.

********Installation Guide****************
Install Prerequisites- Node.js ≥18 with npm, Python 3.11+, PowerShell, and Conda for the spaCy NER env; Postgres and Neo4j.
Setup .env counterpart (.env, api/.env, web/.env, lg_pipeline/.env);
Install Node dependencies: npm install in the repo root, npm install --prefix api, and npm install --prefix web
Install Python tooling: python -m pip install -r lg_pipeline/requirements.txt, then create/prime the Conda NER environment (e.g., conda create -n ner_env python=3.10 followed by installing the spaCy legal model you use).
pip install ./en_legal_ner_trf-0.0.1-py3-none-any.whl
download the hf_cache_inlegalbert from sharepoint and update the env files with its location
-----------------
psql setup: CREATE ROLE legalgenie WITH LOGIN PASSWORD 'password';
CREATE DATABASE legalgenie OWNER legalgenie;
GRANT ALL PRIVILEGES ON DATABASE legalgenie TO legalgenie;
