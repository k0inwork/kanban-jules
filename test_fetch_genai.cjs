const fs = require('fs');

const file = 'src/services/LocalAgent.ts';
let content = fs.readFileSync(file, 'utf8');

// For OpenAI: Update the fetch call inside callLlm
content = content.replace(
  'const response = await fetch(`${this.config.openaiUrl}/chat/completions`, {',
  `let url = \`\${this.config.openaiUrl}/chat/completions\`;
      let fetchArgs: any = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${this.config.openaiKey}\`
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          messages: messages
        })
      };

      if (this.config.proxyUrl) {
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            method: fetchArgs.method,
            headers: fetchArgs.headers,
            body: JSON.parse(fetchArgs.body),
            proxyUrl: this.config.proxyUrl
          })
        };
        url = '/api/proxy';
      }

      const response = await fetch(url, fetchArgs);`
);

// We need to be careful with the original fetch call to remove it
content = content.replace(
  `        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          'Authorization': \`Bearer \${this.config.openaiKey}\`\n        },\n        body: JSON.stringify({\n          model: this.config.openaiModel,\n          messages: messages\n        })\n      });`,
  ''
);

// For Gemini: The @google/genai library might not easily accept a proxy.
// However, according to @google/genai documentation, we can use a custom fetch implementation in the constructor or generateContent
// Actually, the new SDK `GoogleGenAI` might take `fetch` in constructor options.

fs.writeFileSync(file, content);
console.log("Patched LocalAgent.ts fetch calls");
