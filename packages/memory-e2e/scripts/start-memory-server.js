#!/usr/bin/env node
import http from "node:http";
import {
  createMemoryHttpHandler,
  createMemoryService,
  createPostgresMemoryStore
} from "@alfred-labs/memory";

const port = Number(process.env.MEMORY_API_PORT ?? "8080");
const apiKeysRaw = process.env.MEMORY_API_KEYS ?? '{"local-test-key":"user_001"}';
const apiKeys = JSON.parse(apiKeysRaw);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to connect to PostgreSQL.");
  process.exit(1);
}

async function main() {
  const { default: pgModule } = await import("pg");
  const pool = new pgModule.Pool({ connectionString: databaseUrl });
  const pgClient = {
    query: async (text, values) => {
      const result = await pool.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  };

  const store = createPostgresMemoryStore(pgClient);
  const service = createMemoryService({ store });
  const handler = createMemoryHttpHandler({ service, apiKeys });
  const server = http.createServer(handler);

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
