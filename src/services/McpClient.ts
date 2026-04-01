import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class McpManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnecting = false;

  async connect(command: string, args: string[], env?: Record<string, string>) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...env }
      });

      this.client = new Client(
        {
          name: "agent-kanban",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      console.log(`Connected to MCP server: ${command} ${args.join(' ')}`);
    } catch (error) {
      console.error(`Failed to connect to MCP server:`, error);
      this.client = null;
      this.transport = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async getTools() {
    if (!this.client) {
      throw new Error("MCP client not connected.");
    }
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: any) {
    if (!this.client) {
      throw new Error("MCP client not connected.");
    }
    return await this.client.callTool({ name, arguments: args });
  }

  disconnect() {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}

export const mcpManager = new McpManager();
