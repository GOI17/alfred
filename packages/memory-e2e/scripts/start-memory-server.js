#!/usr/bin/env node
import http from "node:http";
import { createMemoryHttpServer } from "@alfred-labs/memory";
import { createPostgresMemoryStore } from "@alfred-labs/memory";

const port = Number(process.env.MEMORY_API_PORT ?? "8080");
const apiKeysRaw = process.env.MEMORY_API_KEYS ?? '{"local-test-key":"user_001"}';
const apiKeys = JSON.parse(apiKeysRaw);

async function createPgClientFromUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return {
    query: async (text, values) => {
      const result = await pool.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  };
}

async function main() {
  const pgClient = await createPgClientFromUrl();
  const store = createPostgresMemoryStore(pgClient);
  const server = createMemoryHttpServer({ apiKeys, service: undefined });

  return new Promise((resolve, reject) => {
    server.listen(port, (error) => {
      if (error) return reject(error);
      console.log(`Memory API listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
