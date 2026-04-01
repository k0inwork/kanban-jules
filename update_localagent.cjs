const fs = require('fs');

let content = fs.readFileSync('src/services/LocalAgent.ts', 'utf8');

// We need to fetch dynamic MCP tools
content = content.replace(
  'const tools = [{ functionDeclarations: [...localRepositoryToolDeclarations, ...localArtifactToolDeclarations, analyzerToolDeclaration, ...localCommunicationToolDeclarations] }];',
  `
    let mcpTools: any[] = [];
    try {
      const mcpResponse = await fetch('/api/mcp/tools');
      if (mcpResponse.ok) {
        const data = await mcpResponse.json();
        if (data.tools) {
          mcpTools = data.tools.map((t: any) => ({
            name: t.name,
            description: t.description || 'No description',
            parameters: {
              type: Type.OBJECT,
              properties: Object.keys(t.inputSchema?.properties || {}).reduce((acc: any, key: string) => {
                acc[key] = { type: Type.STRING, description: t.inputSchema.properties[key].description || '' };
                return acc;
              }, {}),
              required: t.inputSchema?.required || []
            }
          }));
        }
      }
    } catch(err) {
      console.error("Failed to fetch MCP tools", err);
    }
    const tools = [{ functionDeclarations: [...localRepositoryToolDeclarations, ...localArtifactToolDeclarations, analyzerToolDeclaration, ...localCommunicationToolDeclarations, ...mcpTools] }];
  `
);

// We need to add the XML representations of the tools to the prompt.
content = content.replace(
  '- <sendMessage type="info|proposal|alert" content="message text" [title="task title" description="task desc"]/> : Send a message to the user\'s Mailbox.',
  `- <sendMessage type="info|proposal|alert" content="message text" [title="task title" description="task desc"]/> : Send a message to the user's Mailbox.

      DYNAMIC MCP TOOLS AVAILABLE:
      \${mcpTools.map((t: any) => {
        let attrs = '';
        if (t.parameters?.properties) {
          attrs = Object.keys(t.parameters.properties).map(k => \`\${k}="..."\`).join(' ');
        }
        return \`- <\${t.name} \${attrs}/> : \${t.description}\`;
      }).join('\\n      ')}`
);

// And we need to add the execution fallback to /api/mcp/execute
content = content.replace(
  '} else {\n                result = { error: `Unknown tool: ${call.name}` };\n              }',
  `} else {
                // Check if it's an MCP tool
                const isMcpTool = mcpTools.some((t: any) => t.name === call.name);
                if (isMcpTool) {
                  const execResponse = await fetch('/api/mcp/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: call.name, params: call.args })
                  });
                  if (execResponse.ok) {
                    const data = await execResponse.json();
                    result = data.result || data;
                  } else {
                    const errorText = await execResponse.text();
                    result = { error: errorText };
                  }
                } else {
                  result = { error: \`Unknown tool: \${call.name}\` };
                }
              }`
);

fs.writeFileSync('src/services/LocalAgent.ts', content);
