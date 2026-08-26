# DB Assistant

A FastAPI backend + React (Vite/TS) frontend chatbot for querying an on-prem SQL Server
database in natural language. Follows the router → table-selector → SQL-generator →
validator → formatter pipeline discussed alongside this build.

## Structure

```
backend/
  app/
    config.py              # settings, incl. DB connection (fill in later)
    main.py                 # FastAPI app entrypoint
    routes/
      chat.py                # POST /api/chat
      health.py               # GET /api/health
    agents/
      router.py               # off_topic vs db_query classifier
      table_selector.py        # picks relevant tables from the schema catalog
      sql_generator.py         # NL -> SQL
      sql_validator.py         # blocks non-SELECT / unsafe statements
      response_formatter.py    # SQL rows -> natural language
      orchestrator.py          # wires the above together
      llm_client.py            # Azure AI Foundry (Azure OpenAI gpt-4o) wrapper
    db/
      connection.py            # pooled SQLAlchemy/pyodbc engine (stub until configured)
      schema_catalog.py        # INFORMATION_SCHEMA introspection + caching (tables + views)
    models/
      chat.py                  # request/response schemas
  sql/
    views/
      vw_ProjectMemberBudgetFeatures.sql   # deploy on the on-prem server; picked up
                                             # automatically by schema_catalog.py once it exists

frontend/
  src/
    App.tsx                   # chat shell + session state, DB status pill
    sessions.ts                 # localStorage-backed chat history persistence
    components/                # MessageBubble (with query-trace), InputBar, StatusPill,
                                 # ChatHistoryPanel (collapsible left sidebar)
    api.ts                      # calls backend
    styles/theme.css             # teal/blue design tokens
```

## Setup

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` — required to
  run the classifier/SQL agents against your Azure AI Foundry gpt-4o deployment
- `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — **leave blank until your on-prem
  SQL Server is ready.** The app runs fine without these; DB-related questions will
  just get a "not configured yet" reply, and `/api/health` reports `db_configured: false`.

You'll also need the SQL Server ODBC driver installed on the host (`ODBC Driver 18
for SQL Server`), since `pyodbc` uses it under the hood. On Ubuntu:

```bash
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/ubuntu/22.04/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y msodbcsql18
```

Run it:

```bash
uvicorn app.main:app --reload --port 8000
```

**Use a dedicated read-only SQL login** for `DB_USER` — the query validator blocks
non-SELECT statements in code, but the DB-side permission is the real backstop.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173`, proxying `/api/*` to the backend on port 8000
(see `vite.config.ts`).

## When you're ready to connect the DB

1. Deploy `backend/sql/views/vw_ProjectMemberBudgetFeatures.sql` on the on-prem
   SQL Server (it's a `CREATE OR ALTER VIEW`, safe to re-run).
2. Fill in the `DB_*` values in `backend/.env` (copy `.env.example` first — it now
   lists every setting `app/config.py` reads, including `DB_READ_ONLY`,
   `MAX_ROWS_RETURNED`, `QUERY_TIMEOUT_SECONDS`).
3. Restart the backend. On the first DB-related question (or a call to
   `/api/health`), `app/db/schema_catalog.py` will introspect `INFORMATION_SCHEMA`
   and cache both tables *and* views automatically — no manual schema entry needed.
4. `schema_catalog.py:KNOWN_DESCRIPTIONS` already has an entry for
   `dbo.vw_ProjectMemberBudgetFeatures` describing when the table-selector agent
   should prefer it over the raw base tables (budget/member hours, utilization %,
   overrun/over-assignment flags). Add more entries here for any other
   view/table with ambiguous naming.

## Notes

- SQL generation is capped to `SELECT`-only, single-statement, `TOP N`-limited
  queries — see `agents/sql_validator.py`.
- Low-confidence table matches still attempt a best-guess query, then append a
  clarifying follow-up if the result is empty or the match was weak.
- Off-topic messages are redirected to the DB domain rather than answered directly.
- Chat history now lives in a collapsible left sidebar (`ChatHistoryPanel`), same
  layout pattern as this Claude interface: "New chat", a list of past
  conversations titled from the first message, click to switch, hover-to-delete,
  and a collapse toggle. It's persisted client-side in `localStorage`
  (`db-assistant.sessions.v1`) — there's no backend chat-storage table yet, so
  history is per-browser, not per-user-account. If you want it synced across
  devices later, swap `sessions.ts`'s load/save calls for a `/api/sessions`
  endpoint backed by a small SQL table instead of `localStorage`.
