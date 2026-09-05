import { createMemoryMcpServer } from "../packages/memory-mcp/src/index.js";

const unavailable = async () => {
  throw new Error("The production dependency check must not call memory storage.");
};

const server = await createMemoryMcpServer({
  memoryClient: {
    searchMemories: unavailable,
    createMemory: unavailable,
    updateMemory: unavailable,
    deleteMemory: unavailable,
    listMemories: unavailable
  }
});

if (!server || typeof server.connect !== "function") {
  throw new Error("The production MCP server factory did not return a server.");
}
