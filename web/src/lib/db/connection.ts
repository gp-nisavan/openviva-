import fs from "fs";
import path from "path";
import initSqlJs, { Database, SqlValue } from "sql.js";
import { initDatabaseSchema } from "./schema";

// ============================================================================
// DATABASE CONNECTION & INITIALIZATION (SQLite: storage/openviva.db)
// ============================================================================

export interface DBConnection {
  run(sql: string, params?: any[]): void;
  exec(sql: string, params?: any[]): Array<{ columns: string[]; values: any[][] }>;
  prepare(sql: string): any;
  export?(): Uint8Array;
  isNative?: boolean;
}

let dbInstance: DBConnection | null = null;
let initPromise: Promise<DBConnection> | null = null;
let lastLoadedMtimeMs: number = 0;

let BetterSqlite3Module: any = null;
try {
  BetterSqlite3Module = require("better-sqlite3");
} catch {
  BetterSqlite3Module = null;
}

class BetterSqlite3Adapter implements DBConnection {
  public isNative = true;
  public raw: any;

  constructor(db: any) {
    this.raw = db;
  }

  public run(sql: string, params: any[] = []): void {
    const trimmed = sql.trim().toUpperCase();
    if (
      params.length === 0 &&
      (sql.includes(";") ||
        trimmed.startsWith("CREATE") ||
        trimmed.startsWith("PRAGMA") ||
        trimmed.startsWith("ALTER") ||
        trimmed.startsWith("DROP") ||
        trimmed.startsWith("DELETE") ||
        trimmed.startsWith("UPDATE") ||
        trimmed.startsWith("INSERT") ||
        trimmed.startsWith("BEGIN") ||
        trimmed.startsWith("COMMIT") ||
        trimmed.startsWith("ROLLBACK"))
    ) {
      this.raw.exec(sql);
      return;
    }
    const stmt = this.raw.prepare(sql);
    stmt.run(...params);
  }

  public exec(sql: string, params: any[] = []): Array<{ columns: string[]; values: any[][] }> {
    const trimmed = sql.trim().toUpperCase();
    if (
      params.length === 0 &&
      !trimmed.startsWith("SELECT") &&
      !trimmed.startsWith("PRAGMA") &&
      !trimmed.startsWith("EXPLAIN")
    ) {
      this.raw.exec(sql);
      return [];
    }

    try {
      const stmt = this.raw.prepare(sql);
      const rows = stmt.all(...params);
      if (!rows || rows.length === 0) {
        return [];
      }
      const columns = Object.keys(rows[0]);
      const values = rows.map((r: any) => columns.map((c) => r[c]));
      return [{ columns, values }];
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes("does not return data") || err.message.includes("Use run() instead"))
      ) {
        const stmt = this.raw.prepare(sql);
        stmt.run(...params);
        return [];
      }
      throw err;
    }
  }

  public prepare(sql: string): any {
    const stmt = this.raw.prepare(sql);
    let boundParams: any[] = [];
    let currentRows: any[] | null = null;
    let currentRowIdx = -1;

    return {
      bind: (params: any[]) => {
        boundParams = params;
        currentRows = stmt.all(...boundParams);
        currentRowIdx = -1;
      },
      step: () => {
        if (!currentRows) {
          currentRows = stmt.all(...boundParams);
        }
        currentRowIdx++;
        return currentRowIdx < (currentRows ? currentRows.length : 0);
      },
      getAsObject: () => {
        if (!currentRows || currentRowIdx < 0 || currentRowIdx >= currentRows.length) {
          return {};
        }
        return currentRows[currentRowIdx];
      },
      free: () => {
        currentRows = null;
        currentRowIdx = -1;
      },
    };
  }

  public export(): Uint8Array {
    return new Uint8Array(0);
  }
}

export function getStorageBaseDir(): string {
  const parentStorage = path.resolve(process.cwd(), "..", "storage");
  const localStorage = path.resolve(process.cwd(), "storage");
  if (fs.existsSync(parentStorage)) {
    return parentStorage;
  }
  if (fs.existsSync(localStorage)) {
    return localStorage;
  }
  return parentStorage;
}

export function getDatabasePath(): string {
  const baseDir = getStorageBaseDir();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return path.join(baseDir, "openviva.db");
}

export function getBiometricsFacesDir(): string {
  const baseDir = getStorageBaseDir();
  const dir = path.join(baseDir, "biometrics", "faces");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getRecordingsDir(): string {
  const baseDir = getStorageBaseDir();
  const dir = path.join(baseDir, "recordings");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getBiometricsVoicesDir(): string {
  const baseDir = getStorageBaseDir();
  const dir = path.join(baseDir, "biometrics", "voices");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function persistDatabase(): void {
  if (!dbInstance) return;
  if (dbInstance.isNative) {
    // Native SQLite with WAL mode writes directly to disk in real-time. No-op.
    return;
  }
  if (!dbInstance.export) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const dbPath = getDatabasePath();
    const tempPath = `${dbPath}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, dbPath);
    try {
      lastLoadedMtimeMs = fs.statSync(dbPath).mtimeMs;
    } catch (statErr) {
      console.debug("[OpenViva DB] Stat mtime check warning:", statErr);
    }
  } catch (err) {
    console.error("Failed to persist SQLite database to disk:", err);
  }
}

export function getWasmPath(): string {
  const localWasm = path.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  if (fs.existsSync(localWasm)) return localWasm;
  const subWasm = path.resolve(process.cwd(), "web", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  if (fs.existsSync(subWasm)) return subWasm;
  return localWasm;
}

export function getSyncDB(): DBConnection | null {
  if (dbInstance && (dbInstance as any).isNative) {
    return dbInstance;
  }
  if (BetterSqlite3Module) {
    try {
      const dbPath = getDatabasePath();
      const rawDb = new BetterSqlite3Module(dbPath, { timeout: 10000 });
      rawDb.pragma("journal_mode = WAL");
      rawDb.pragma("synchronous = NORMAL");
      rawDb.pragma("busy_timeout = 10000");
      rawDb.pragma("foreign_keys = ON");

      const adapter = new BetterSqlite3Adapter(rawDb);
      initDatabaseSchema(adapter);
      dbInstance = adapter;
      return dbInstance;
    } catch (err) {
      console.debug("[OpenViva DB] getSyncDB initialization warning:", err);
      return dbInstance;
    }
  }
  return dbInstance;
}

export async function getDB(forceReload = false): Promise<DBConnection> {
  const dbPath = getDatabasePath();

  // 1. Native better-sqlite3 with WAL mode (high-throughput, zero-lock concurrency)
  if (BetterSqlite3Module) {
    if (dbInstance && !forceReload && (dbInstance as any).isNative) {
      return dbInstance;
    }
    if (forceReload && dbInstance) {
      dbInstance = null;
      initPromise = null;
    }
    if (initPromise) return initPromise;

    initPromise = (async () => {
      console.log(`[OpenViva DB] Using Native better-sqlite3 with WAL mode at: ${dbPath}`);
      const rawDb = new BetterSqlite3Module(dbPath, { timeout: 10000 });
      rawDb.pragma("journal_mode = WAL");
      rawDb.pragma("synchronous = NORMAL");
      rawDb.pragma("busy_timeout = 10000");
      rawDb.pragma("foreign_keys = ON");

      const adapter = new BetterSqlite3Adapter(rawDb);
      initDatabaseSchema(adapter);
      dbInstance = adapter;
      return dbInstance;
    })();

    return initPromise;
  }

  // 2. WebAssembly fallback via sql.js
  if (forceReload && dbInstance) {
    dbInstance = null;
    initPromise = null;
  }

  if (dbInstance && !forceReload) {
    if (fs.existsSync(dbPath)) {
      try {
        const currentMtime = fs.statSync(dbPath).mtimeMs;
        if (currentMtime > lastLoadedMtimeMs) {
          console.log(`[OpenViva DB] External modification detected (mtime: ${currentMtime} > ${lastLoadedMtimeMs}). Hot-reloading WASM DB...`);
          const fileBuffer = fs.readFileSync(dbPath);
          const SQL = await initSqlJs({ locateFile: () => getWasmPath() });
          dbInstance = new SQL.Database(fileBuffer);
          lastLoadedMtimeMs = currentMtime;
          initDatabaseSchema(dbInstance);
        }
      } catch (err) {
        console.warn("[OpenViva DB] Failed to check mtime for hot reload:", err);
      }
    }
    return dbInstance;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log(`[OpenViva DB] Initializing WASM SQLite database at: ${dbPath}`);
    const SQL = await initSqlJs({
      locateFile: () => getWasmPath(),
    });

    let db: any;
    if (fs.existsSync(dbPath)) {
      try {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        lastLoadedMtimeMs = fs.statSync(dbPath).mtimeMs;
        console.log(`[OpenViva DB] Loaded existing SQLite database (${fileBuffer.length} bytes, mtime: ${lastLoadedMtimeMs})`);
      } catch (readErr) {
        console.error(`[OpenViva DB] Failed to read existing db, initializing blank:`, readErr);
        db = new SQL.Database();
      }
    } else {
      console.log(`[OpenViva DB] No existing database found. Creating fresh instance.`);
      db = new SQL.Database();
    }

    initDatabaseSchema(db);
    dbInstance = db;
    persistDatabase();
    return dbInstance!;
  })();

  return initPromise;
}

