/** Synthetic CMS in the local SQLite database. Never imports an application/CMS credential. */
export class SqliteHostStore {
  constructor(adapter) {
    this.db = adapter.raw;
    this.db.exec(`CREATE TABLE IF NOT EXISTS demo_host_resources(scope_id TEXT PRIMARY KEY,revision TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS demo_host_effects(scope_id TEXT NOT NULL,effect_key TEXT NOT NULL,payload_hash TEXT NOT NULL,outcome TEXT NOT NULL,resulting_revision TEXT,PRIMARY KEY(scope_id,effect_key));`);
  }
  seed(scope) { this.db.prepare("INSERT OR IGNORE INTO demo_host_resources VALUES(?,'7',?)").run(scope, '# October release\n\nDraft outline.'); }
  async read(scope) { this.seed(scope); const row = this.db.prepare('SELECT * FROM demo_host_resources WHERE scope_id=?').get(scope); return { revision: row.revision, text: row.body }; }
  async receipt(scope, key) { const row = this.db.prepare('SELECT * FROM demo_host_effects WHERE scope_id=? AND effect_key=?').get(scope, key); return row ? { payloadHash: row.payload_hash, outcome: row.outcome, resultingRevision: row.resulting_revision } : null; }
  async apply(scope, key, payloadHash, expected, body) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.seed(scope);
      const previous = this.db.prepare('SELECT * FROM demo_host_effects WHERE scope_id=? AND effect_key=?').get(scope, key);
      if (previous) {
        if (previous.payload_hash !== payloadHash) throw new Error('Effect key content conflict');
        this.db.exec('COMMIT'); return { payloadHash, outcome: previous.outcome, resultingRevision: previous.resulting_revision };
      }
      const resource = this.db.prepare('SELECT * FROM demo_host_resources WHERE scope_id=?').get(scope);
      const success = resource.revision === expected;
      const revision = success ? String(Number(resource.revision) + 1) : resource.revision;
      if (success) this.db.prepare('UPDATE demo_host_resources SET revision=?,body=? WHERE scope_id=? AND revision=?').run(revision, body, scope, expected);
      this.db.prepare('INSERT INTO demo_host_effects VALUES(?,?,?,?,?)').run(scope, key, payloadHash, success ? 'succeeded' : 'conflict', revision);
      this.db.exec('COMMIT'); return { payloadHash, outcome: success ? 'succeeded' : 'conflict', resultingRevision: revision };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async change(scope, body) { this.seed(scope); this.db.prepare('UPDATE demo_host_resources SET revision=CAST(CAST(revision AS INTEGER)+1 AS TEXT),body=? WHERE scope_id=?').run(body, scope); }
  get writes() { return this.db.prepare("SELECT count(*) AS n FROM demo_host_effects WHERE outcome='succeeded'").get().n; }
}
