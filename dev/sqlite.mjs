/** Offline test/development adapter only. Uses SQLite's real transactions, not workerd/D1. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const schema = new URL('../workers/conversations/migrations/0001_initial.sql', import.meta.url);
export class SqliteAdapter {
  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (!this.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scopes'").get()) this.raw.exec(readFileSync(schema, 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql, []); }
  async batch(statements) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const rows = statements.map(s => s.execute());
      this.raw.exec('COMMIT'); return rows;
    } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
  close() { this.raw.close(); }
}
class Statement {
  constructor(db, sql, values) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  execute() {
    const q = this.db.raw.prepare(this.sql);
    if (q.columns().length) return { success: true, results: q.all(...this.values), meta: { changes: 0 } };
    const result = q.run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() { return this.execute(); }
}
