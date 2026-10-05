import { rmSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { errorMessage, type MemoryTarget, type MemoryUnit } from '@atd/agent-contracts';
import { ftsMatch, likePattern, trigramMatchable } from './fts-query.js';

/**
 * The search index of the memory units, `<memory root>/index.db` on Node's built-in `node:sqlite`.
 * It is a cache of the unit files and never their truth: an index that cannot be opened, has
 * another schema or turns out corrupt is deleted and rebuilt from the files, and one that cannot
 * be written at all lives in memory. The external-content FTS5 `trigram` table and its sync
 * triggers follow pi-hermes-memory 0.9.9 (MIT, © 2025 Chandra Teja, src/store/schema.ts).
 *
 * Terms of three or more characters go through FTS5 ranked with BM25 (name 5, description 3,
 * body 1); shorter terms, which trigrams cannot match (a two-character Chinese word), and every
 * search on a runtime without FTS5 go through LIKE with the same weights.
 */
const SCHEMA = '1';

const UNITS_SQL = `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE units(
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    revision TEXT NOT NULL,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL
  );
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE units_fts USING fts5(
    name, description, body, content='units', content_rowid='rowid', tokenize='trigram'
  );
  CREATE TRIGGER units_ai AFTER INSERT ON units BEGIN
    INSERT INTO units_fts(rowid, name, description, body)
      VALUES (new.rowid, new.name, new.description, new.body);
  END;
  CREATE TRIGGER units_ad AFTER DELETE ON units BEGIN
    INSERT INTO units_fts(units_fts, rowid, name, description, body)
      VALUES ('delete', old.rowid, old.name, old.description, old.body);
  END;
  CREATE TRIGGER units_au AFTER UPDATE ON units BEGIN
    INSERT INTO units_fts(units_fts, rowid, name, description, body)
      VALUES ('delete', old.rowid, old.name, old.description, old.body);
    INSERT INTO units_fts(rowid, name, description, body)
      VALUES (new.rowid, new.name, new.description, new.body);
  END;
`;

/** One search: its terms (`searchTerms`), an optional type and the most hits to answer. */
export interface IndexQuery {
  terms: readonly string[];
  type: MemoryTarget | undefined;
  limit: number;
}

/** An index whose schema is not this build's: rebuilt without a warning. */
class StaleIndex extends Error {}

let ftsSupport: boolean | undefined;

/** Whether this runtime's SQLite has FTS5 with the trigram tokenizer (checked once). */
function ftsAvailable(): boolean {
  if (ftsSupport !== undefined) return ftsSupport;
  const probe = new DatabaseSync(':memory:');
  try {
    probe.exec("CREATE VIRTUAL TABLE probe USING fts5(text, tokenize='trigram')");
    ftsSupport = true;
  } catch {
    ftsSupport = false;
  } finally {
    probe.close();
  }
  return ftsSupport;
}

function removeDatabase(file: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(`${file}${suffix}`, { force: true });
}

function createSchema(db: DatabaseSync, fts: boolean): void {
  db.exec(UNITS_SQL);
  if (fts) db.exec(FTS_SQL);
  const meta = db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)');
  meta.run('schema', SCHEMA);
  meta.run('fts', fts ? '1' : '0');
}

/** Opens `file`, creating the schema in a new database; throws when it is unusable or stale. */
function openChecked(file: string, fts: boolean): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    if (!tables.length) {
      createSchema(db, fts);
      return db;
    }
    const rows = tables.some((row) => row.name === 'meta')
      ? db.prepare('SELECT key, value FROM meta').all()
      : [];
    const meta = new Map(rows.map((row) => [String(row.key), String(row.value)]));
    if (meta.get('schema') !== SCHEMA || meta.get('fts') !== (fts ? '1' : '0'))
      throw new StaleIndex('The memory index has another schema.');
    const check = db.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok')
      throw new Error('The memory index failed its integrity check.');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class MemoryIndex {
  private constructor(
    private db: DatabaseSync,
    private readonly file: string,
    /** Whether searches of three-character terms use FTS5; otherwise every search uses LIKE. */
    readonly fts: boolean,
    private readonly warn: (message: string) => void,
  ) {}

  /** Opens the index at `file`, rebuilding or falling back to memory as needed; never throws. */
  static open(file: string, warn: (message: string) => void): MemoryIndex {
    const fts = ftsAvailable();
    if (!fts) warn('This runtime has no SQLite FTS5; memory search matches plain substrings.');
    return new MemoryIndex(MemoryIndex.connect(file, fts, warn), file, fts, warn);
  }

  private static connect(file: string, fts: boolean, warn: (message: string) => void) {
    try {
      return openChecked(file, fts);
    } catch (error) {
      if (!(error instanceof StaleIndex))
        warn(`The memory index was rebuilt from the memory files (${errorMessage(error)}).`);
    }
    try {
      removeDatabase(file);
      return openChecked(file, fts);
    } catch (error) {
      warn(`The memory index is kept in memory only (${errorMessage(error)}).`);
      return openChecked(':memory:', fts);
    }
  }

  /** Drops the index after a failure; the next `sync` fills the new one from the files. */
  reset(): void {
    this.close();
    try {
      removeDatabase(this.file);
    } catch (error) {
      this.warn(`The memory index could not be deleted (${errorMessage(error)}).`);
    }
    this.db = MemoryIndex.connect(this.file, this.fts, this.warn);
  }

  /** Makes the index hold exactly `units`, rewriting only rows whose revision changed. */
  sync(units: readonly MemoryUnit[]): void {
    const known = new Map(
      this.db
        .prepare('SELECT id, revision FROM units')
        .all()
        .map((row) => [String(row.id), String(row.revision)]),
    );
    const upsert = this.db.prepare(`
      INSERT INTO units(id, revision, type, enabled, name, description, body)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, type = excluded.type,
        enabled = excluded.enabled, name = excluded.name, description = excluded.description,
        body = excluded.body
    `);
    const remove = this.db.prepare('DELETE FROM units WHERE id = ?');
    this.db.exec('BEGIN');
    try {
      for (const unit of units) {
        if (known.get(unit.id) === unit.revision) continue;
        const { id, revision, type, enabled, name, description, body } = unit;
        upsert.run(id, revision, type, enabled ? 1 : 0, name, description, body);
      }
      const live = new Set(units.map((unit) => unit.id));
      for (const id of known.keys()) if (!live.has(id)) remove.run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * The ids of the enabled units matching every term, best first; when none matches them all,
   * those matching any term.
   */
  search(query: IndexQuery): string[] {
    const mode = this.fts && query.terms.every(trigramMatchable) ? 'fts' : 'like';
    const run = (joiner: 'AND' | 'OR') =>
      mode === 'fts' ? this.ftsSearch(query, joiner) : this.likeSearch(query, joiner);
    const all = run('AND');
    return all.length || query.terms.length < 2 ? all : run('OR');
  }

  private ftsSearch(query: IndexQuery, joiner: 'AND' | 'OR'): string[] {
    return this.db
      .prepare(
        `SELECT u.id AS id FROM units_fts JOIN units u ON u.rowid = units_fts.rowid
          WHERE units_fts MATCH ?1 AND u.enabled = 1 AND (?2 IS NULL OR u.type = ?2)
          ORDER BY bm25(units_fts, 5.0, 3.0, 1.0), u.name LIMIT ?3`,
      )
      .all(ftsMatch(query.terms, joiner), query.type ?? null, query.limit)
      .map((row) => String(row.id));
  }

  private likeSearch(query: IndexQuery, joiner: 'AND' | 'OR'): string[] {
    const params: Record<string, SQLInputValue> = { type: query.type ?? null, limit: query.limit };
    const like = (column: string, term: string) => `(${column} LIKE :${term} ESCAPE '\\')`;
    const matches: string[] = [];
    const scores: string[] = [];
    query.terms.forEach((term, index) => {
      const key = `t${index}`;
      params[key] = likePattern(term);
      const [name, description, body] = ['u.name', 'u.description', 'u.body'].map((column) =>
        like(column, key),
      );
      matches.push(`(${name} OR ${description} OR ${body})`);
      scores.push(`${name} * 5 + ${description} * 3 + ${body}`);
    });
    return this.db
      .prepare(
        `SELECT u.id AS id, ${scores.join(' + ')} AS score FROM units u
          WHERE u.enabled = 1 AND (:type IS NULL OR u.type = :type)
            AND (${matches.join(joiner === 'AND' ? ' AND ' : ' OR ')})
          ORDER BY score DESC, u.name LIMIT :limit`,
      )
      .all(params)
      .map((row) => String(row.id));
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
