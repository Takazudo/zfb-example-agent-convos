-- Implemented repository schema. Tested with Node SQLite, NOT verified on D1/workerd.
-- Primary reads are the baseline. App authorization is mandatory on every query.
-- All IDs/JSON are validated by the service as well as by these constraints.
PRAGMA foreign_keys = ON;

CREATE TABLE scopes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  UNIQUE(tenant_id, application_id, workspace_id)
);
CREATE TABLE conversations (
  scope_id TEXT NOT NULL REFERENCES scopes(id),
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id)
);
CREATE INDEX conversations_list ON conversations(scope_id,owner_id,archived,updated_at DESC,id);
CREATE TABLE messages (
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  parts_json TEXT NOT NULL CHECK(json_valid(parts_json) AND length(CAST(parts_json AS BLOB)) <= 65536),
  state TEXT NOT NULL CHECK(state IN ('accepted','streaming','complete','partial')),
  created_seq INTEGER NOT NULL CHECK(created_seq > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id),
  UNIQUE(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id) REFERENCES conversations(scope_id,id)
);
CREATE INDEX messages_order ON messages(scope_id,conversation_id,created_seq,id);
CREATE TABLE skills (
  scope_id TEXT NOT NULL REFERENCES scopes(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 0 is an internal creation state; creation MUST insert revision 1 and move head
  -- in the same transaction. Never return a head-0 skill from the API.
  head_version INTEGER NOT NULL DEFAULT 0 CHECK(head_version >= 0),
  PRIMARY KEY(scope_id,id)
);
CREATE TABLE skill_revisions (
  scope_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 32768),
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  note TEXT NOT NULL,
  author_id TEXT NOT NULL,
  restored_from_version INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,skill_id,version),
  FOREIGN KEY(scope_id,skill_id) REFERENCES skills(scope_id,id),
  FOREIGN KEY(scope_id,skill_id,restored_from_version) REFERENCES skill_revisions(scope_id,skill_id,version)
);
CREATE TRIGGER skill_revision_no_update BEFORE UPDATE ON skill_revisions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SKILL_REVISION'); END;
CREATE TRIGGER skill_head_must_exist BEFORE UPDATE OF head_version ON skills
WHEN NOT EXISTS(SELECT 1 FROM skill_revisions r WHERE r.scope_id=NEW.scope_id AND r.skill_id=NEW.id AND r.version=NEW.head_version)
BEGIN SELECT RAISE(ABORT,'SKILL_HEAD_MISSING'); END;
CREATE TABLE context_snapshots (
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  through_seq INTEGER NOT NULL CHECK(through_seq >= 0),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB)) <= 262144),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id),
  UNIQUE(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id) REFERENCES conversations(scope_id,id)
);
CREATE TRIGGER context_snapshot_no_update BEFORE UPDATE ON context_snapshots
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTEXT_SNAPSHOT'); END;
CREATE TABLE runs (
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  input_message_id TEXT NOT NULL,
  context_snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','awaiting_approval','applying','cancel_requested','needs_reconciliation','completed','failed','cancelled','conflicted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  retry_of_run_id TEXT,
  refresh_of_proposal_id TEXT,
  claim_token TEXT,
  claim_expires_at TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  outcome TEXT CHECK(outcome IN ('read_only','applied','rejected')),
  error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id),
  UNIQUE(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id) REFERENCES conversations(scope_id,id),
  FOREIGN KEY(scope_id,conversation_id,input_message_id) REFERENCES messages(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id,context_snapshot_id) REFERENCES context_snapshots(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id,retry_of_run_id) REFERENCES runs(scope_id,conversation_id,id)
);
CREATE UNIQUE INDEX one_active_run ON runs(scope_id,conversation_id)
WHERE status IN ('queued','running','awaiting_approval','applying','cancel_requested','needs_reconciliation');
CREATE INDEX abandoned_runs ON runs(status,claim_expires_at);
CREATE TABLE run_skill_pins (
  scope_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY(scope_id,run_id,skill_id),
  FOREIGN KEY(scope_id,run_id) REFERENCES runs(scope_id,id),
  FOREIGN KEY(scope_id,skill_id,version) REFERENCES skill_revisions(scope_id,skill_id,version)
);
CREATE TRIGGER run_skill_pin_no_update BEFORE UPDATE ON run_skill_pins
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SKILL_PIN'); END;
CREATE TABLE events (
  scope_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 9007199254740991),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  event_type TEXT NOT NULL CHECK(event_type IN ('conversation.upsert','message.upsert','run.upsert','proposal.upsert','tool.receipt')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB)) <= 131072),
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,conversation_id,seq),
  FOREIGN KEY(scope_id,conversation_id) REFERENCES conversations(scope_id,id)
);
CREATE TRIGGER event_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
CREATE TABLE proposals (
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','applied','rejected','stale','unknown')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  action_json TEXT NOT NULL CHECK(json_valid(action_json) AND length(CAST(action_json AS BLOB)) <= 65536),
  base_revision TEXT, -- NULL is expected absence, never unconditional overwrite
  display_json TEXT NOT NULL CHECK(json_valid(display_json) AND length(CAST(display_json AS BLOB)) <= 131072),
  decision_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id),
  UNIQUE(scope_id,conversation_id,id),
  FOREIGN KEY(scope_id,conversation_id,run_id) REFERENCES runs(scope_id,conversation_id,id)
);
CREATE TRIGGER proposal_payload_no_update BEFORE UPDATE OF payload_hash,action_json,base_revision,display_json ON proposals
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROPOSAL_PAYLOAD'); END;
CREATE TABLE tool_effects (
  scope_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('executing','succeeded','failed','unknown')),
  receipt_json TEXT CHECK(receipt_json IS NULL OR (json_valid(receipt_json) AND length(CAST(receipt_json AS BLOB)) <= 32768)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,effect_key),
  UNIQUE(scope_id,proposal_id),
  FOREIGN KEY(scope_id,proposal_id) REFERENCES proposals(scope_id,id)
);
CREATE TABLE commands (
  scope_id TEXT NOT NULL REFERENCES scopes(id),
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,actor_id,operation,request_key)
);
CREATE TABLE outbox (
  scope_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('generate','apply','reconcile')),
  status TEXT NOT NULL CHECK(status IN ('pending','sent')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope_id,id),
  FOREIGN KEY(scope_id,run_id) REFERENCES runs(scope_id,id)
);
CREATE INDEX outbox_pending ON outbox(status,next_attempt_at);
-- Use inside a D1 batch as a transaction-aborting predicate assertion.
-- A zero-row CAS UPDATE is NOT a SQL exception and would not roll back a batch.
-- Insert assertion first, perform writes, delete assertion last. See schema-notes.md.
CREATE TABLE transaction_assertions (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK(ok=1)
);
