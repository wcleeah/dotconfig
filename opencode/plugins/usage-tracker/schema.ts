import { Database } from "bun:sqlite"
import { expandPath, ensureDirectoryExists } from "./utils"

export const SCHEMA = `
-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  parent_id TEXT,
  project_path TEXT,
  worktree TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  ended_at INTEGER
);

-- Turns (user turn = everything from user message to session idle)
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_turn_id TEXT,
  user_message TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- Messages (user + assistant)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL,
  content TEXT,
  agent TEXT,
  is_subagent_prompt INTEGER DEFAULT 0,
  model_id TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost REAL,
  finish_reason TEXT
);

-- Parts (all message parts - text, tool, reasoning, file, etc.)
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- Error/data loss log
CREATE TABLE IF NOT EXISTS plugin_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT,
  event_data TEXT,
  error_message TEXT,
  stack_trace TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);
CREATE INDEX IF NOT EXISTS idx_turns_parent ON turns(parent_turn_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_turn ON messages(turn_id);
CREATE INDEX IF NOT EXISTS idx_messages_model ON messages(model_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent);
CREATE INDEX IF NOT EXISTS idx_parts_message ON parts(message_id);
CREATE INDEX IF NOT EXISTS idx_parts_session ON parts(session_id);
CREATE INDEX IF NOT EXISTS idx_parts_type ON parts(type);
CREATE INDEX IF NOT EXISTS idx_parts_created ON parts(created_at);
CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON plugin_errors(timestamp);
`

export const initDatabase = (dbPath: string): Database => {
  const expandedPath = expandPath(dbPath)
  ensureDirectoryExists(expandedPath)
  const db = new Database(expandedPath, { create: true })

  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    try {
      db.exec(stmt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("duplicate column")) {
        throw err
      }
    }
  }

  return db
}
