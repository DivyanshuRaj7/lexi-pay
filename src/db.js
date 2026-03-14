import Database from 'better-sqlite3';

const db = new Database('./lexipay.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    filename TEXT,
    total_clauses INTEGER,
    created_at INTEGER
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS clause_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    clause_index INTEGER,
    clause_text TEXT,
    severity TEXT,
    risk_type TEXT,
    explanation TEXT,
    recommendation TEXT,
    paid INTEGER DEFAULT 0,
    tx_hash TEXT,
    analyzed_at INTEGER
  )
`);

export function createSession(id, filename, totalClauses) {
    const stmt = db.prepare('INSERT INTO sessions (id, filename, total_clauses, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(id, filename, totalClauses, Date.now());
}

export function saveClauseResult(sessionId, result) {
    const stmt = db.prepare(`
        INSERT INTO clause_results (
            session_id, clause_index, clause_text, severity, risk_type, explanation, recommendation, analyzed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        sessionId,
        result.index,
        result.clause,
        result.severity,
        result.risk_type,
        result.explanation,
        result.recommendation,
        Date.now()
    );
}

export function markClausePaid(sessionId, clauseIndex, txHash) {
    const stmt = db.prepare('UPDATE clause_results SET paid = 1, tx_hash = ? WHERE session_id = ? AND clause_index = ?');
    stmt.run(txHash, sessionId, clauseIndex);
}

export function getClauseResult(sessionId, clauseIndex) {
    const stmt = db.prepare('SELECT * FROM clause_results WHERE session_id = ? AND clause_index = ?');
    return stmt.get(sessionId, clauseIndex) || null;
}

export function getSessionResults(sessionId) {
    const stmt = db.prepare('SELECT * FROM clause_results WHERE session_id = ? ORDER BY clause_index ASC');
    return stmt.all(sessionId);
}

export function getSession(id) {
    const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) || null;
}

export default db;
