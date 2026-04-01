# NotebookLM MCP Integration Analysis

## 1. Overview
The goal is to integrate the [notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) directly into the Agent Kanban app. This integration will expose Google NotebookLM's capabilities (listing notebooks, querying them, generating studio content, etc.) as Model Context Protocol (MCP) tool calls that the LocalAgent (Gemini/OpenAI) can autonomously use.

## 2. Authentication Strategy
The notebooklm-mcp-cli uses an undocumented internal API for NotebookLM, which fundamentally requires a valid session cookie to authenticate requests to Google's servers.

### How it works in the CLI
The CLI has an `nlm login` command that launches a headless browser, prompts the user to log in, and extracts the cookies. It can also accept cookies manually via `nlm login --manual --file cookies.txt`.

### How to get the NotebookLM Cookie Manually
For a web application integration where launching a local browser profile isn't always reliable or possible (especially in a containerized backend), manual extraction is the most stable approach.

**Steps to obtain the cookie:**
1. Open a regular web browser (Chrome, Edge, Firefox).
2. Navigate to [NotebookLM](https://notebooklm.google.com/) and log in with your Google account.
3. Open the Developer Tools (F12 or right-click -> Inspect).
4. Go to the **Network** tab.
5. Refresh the page.
6. Look for a request to `notebooklm.google.com` (usually the first one, a Document request).
7. Click on the request, scroll down to the **Request Headers** section.
8. Find the `Cookie:` header, right-click, and copy its entire value.

### Application Integration
We will add a "NotebookLM Cookie" field to the App's **Settings Modal**. When saved:
1. The frontend stores it in `localStorage` and sends it to the backend (`server.ts`).
2. The backend (`server.ts`) writes this cookie to a temporary file (e.g., `.notebooklm-cookies.txt`).
3. The backend runs `uvx --from notebooklm-mcp-cli nlm login --manual --file .notebooklm-cookies.txt` during initialization to authenticate the MCP server.

## 3. Server Architecture
To connect `server.ts` to the `notebooklm-mcp-cli`:
1. **MCP Client setup**: We will use the official `@modelcontextprotocol/sdk` to build an MCP client inside `server.ts`.
2. **Process Spawning**: We will spawn the MCP server process:
   ```ts
   const transport = new StdioClientTransport({
     command: "uvx",
     args: ["--from", "notebooklm-mcp-cli", "notebooklm-mcp"]
   });
   ```
3. **Tool Proxying**: We will add a new endpoint `GET /api/mcp/tools` to `server.ts`. When the frontend calls this, `server.ts` will request `listTools()` from the NotebookLM MCP and return them.
4. **Execution Proxying**: We will update the existing `POST /api/mcp/execute` to forward calls to the MCP client if the action name matches a NotebookLM tool.

## 4. Agent Tool Exposure
In `src/services/LocalAgent.ts`:
1. Before starting the LLM loop, fetch available tools from `GET /api/mcp/tools`.
2. Map these dynamic tools into the Gemini `functionDeclarations` format (converting JSON schema to Gemini Type schema).
3. Append instructions to the system prompt informing the agent about the newly available tools (e.g., `<notebook_list/>`, `<notebook_query notebook_id="..." query="..."/>`).
4. During the loop, handle tool calls by posting to `/api/mcp/execute`.

## 5. Feasibility and Considerations
- **Environment**: The user needs `uv` (or `pipx`) installed on the host machine running `server.ts` because we are invoking `uvx`. Since `uv` is extremely fast and standardizing in Python ecosystems, this is acceptable. We will run a setup script or spawn command assuming `uvx` is available.
- **Latency**: Calling external MCP servers adds a slight JSON-RPC overhead, but this is negligible.
- **Context Limits**: NotebookLM has 35 tools. We must ensure the `LocalAgent` prompt has enough context window for the schemas. Gemini Flash 1.5 has a 1M context window, which is more than enough.
