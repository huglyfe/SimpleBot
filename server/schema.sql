PRAGMA foreign_keys = ON;
PRAGMA user_version = 19;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  bot_slug TEXT NOT NULL,
  preset_slug TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE message_positions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  source TEXT,
  selected_variant_id TEXT REFERENCES message_variants(id)
    DEFERRABLE INITIALLY DEFERRED,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, ordinal),
  CHECK (
    (role = 'user' AND source IS NOT NULL AND selected_variant_id IS NULL) OR
    (role = 'assistant' AND source IS NULL)
  )
) STRICT;

CREATE TABLE message_variants (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES message_positions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  source TEXT NOT NULL,
  trace_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(trace_json) AND json_type(trace_json) = 'array'),
  usage_json TEXT NOT NULL CHECK (json_valid(usage_json)),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (position_id, ordinal)
) STRICT;

CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES message_positions(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES message_variants(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  type TEXT NOT NULL,
  arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
  state TEXT NOT NULL CHECK (
    state IN ('candidate', 'accepted', 'applied', 'failed', 'unresolved')
  ),
  result TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (variant_id, ordinal)
) STRICT;

CREATE TABLE leaves (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_ordinal INTEGER NOT NULL,
  end_ordinal INTEGER NOT NULL,
  prior_leaf_id TEXT REFERENCES leaves(id),
  trigger_position_id TEXT NOT NULL REFERENCES message_positions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed')),
  summary TEXT,
  summary_outcome TEXT CHECK (
    summary_outcome IN ('model', 'fallback-unavailable', 'fallback-clipped')
  ),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  CHECK (end_ordinal >= start_ordinal),
  CHECK (
    (
      state = 'pending' AND summary IS NULL AND summary_outcome IS NULL AND
      committed_at IS NULL
    ) OR (
      state = 'committed' AND summary IS NOT NULL AND
      summary_outcome IS NOT NULL AND committed_at IS NOT NULL
    )
  ),
  UNIQUE (session_id, end_ordinal)
) STRICT;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position_id TEXT REFERENCES message_positions(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE session_variables (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (session_id, name)
) STRICT;

CREATE TABLE session_todos (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  due TEXT,
  note TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
) STRICT;

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expression TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
) STRICT;

CREATE TABLE auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_key_hash TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE auth_pairing_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE TABLE search_documents (
  handle TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'leaf')),
  ordinal INTEGER NOT NULL,
  source TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
  source,
  content = 'search_documents',
  content_rowid = 'rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_fts(rowid, source) VALUES (new.rowid, new.source);
END;

CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_fts(search_fts, rowid, source)
  VALUES ('delete', old.rowid, old.source);
END;

CREATE TRIGGER search_documents_update AFTER UPDATE OF source ON search_documents BEGIN
  INSERT INTO search_fts(search_fts, rowid, source)
  VALUES ('delete', old.rowid, old.source);
  INSERT INTO search_fts(rowid, source) VALUES (new.rowid, new.source);
END;

CREATE INDEX message_positions_session_order
  ON message_positions(session_id, ordinal);

CREATE INDEX message_variants_position_order
  ON message_variants(position_id, ordinal);

CREATE INDEX effects_session_state_order
  ON effects(session_id, state, position_id, ordinal);

CREATE INDEX attachments_session_position
  ON attachments(session_id, position_id);

CREATE INDEX leaves_session_range
  ON leaves(session_id, start_ordinal, end_ordinal);

CREATE INDEX search_documents_session_order
  ON search_documents(session_id, ordinal);

CREATE INDEX schedules_enabled ON schedules(enabled, id);
