const fs = require('fs');

let content = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');

// The sed patch for handleSubmit failed, let's fix it manually
content = content.replace(
  /const handleSubmit = \(e: React\.FormEvent\) => \{\n\s*e\.preventDefault\(\);\n\s*onSave\(\n\s*endpoint, apiKey, repoUrl, branch, sourceName, sourceId,\n\s*apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel\n\s*\);\n\s*onClose\(\);\n\s*\};/,
  `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (notebooklmCookie && notebooklmCookie !== initialNotebooklmCookie) {
      setIsConfiguringMcp(true);
      try {
        await fetch('/api/mcp/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: notebooklmCookie })
        });
      } catch (err) {
        console.error("Failed to setup NotebookLM MCP", err);
      }
      setIsConfiguringMcp(false);
    }

    onSave(
      endpoint, apiKey, repoUrl, branch, sourceName, sourceId,
      apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel, notebooklmCookie
    );
    onClose();
  };`
);

fs.writeFileSync('src/components/SettingsModal.tsx', content);
