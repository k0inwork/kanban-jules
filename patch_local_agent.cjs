const fs = require('fs');

const file = 'src/services/LocalAgent.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '  openaiModel: string;',
  '  openaiModel: string;\n  proxyUrl?: string;'
);

const fetchCode = `
      let url = \`\${this.config.openaiUrl}/chat/completions\`;
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
        url = '/api/proxy';
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: \`\${this.config.openaiUrl}/chat/completions\`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${this.config.openaiKey}\`
            },
            body: {
              model: this.config.openaiModel,
              messages: messages
            },
            proxyUrl: this.config.proxyUrl
          })
        };
      }

      const response = await fetch(url, fetchArgs);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(\`OpenAI API error: \${data.error?.message || response.statusText}\`);
      }

      const responseData = this.config.proxyUrl ? data.data : data;
      return responseData.choices[0].message.content;
`;

// Replace the openai fetch block
const openaiBlockStart = `      const response = await fetch(\`\${this.config.openaiUrl}/chat/completions\`, {`;
const openaiBlockEnd = `return data.choices[0].message.content;`;

const blockRegex = new RegExp(
  openaiBlockStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + openaiBlockEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

content = content.replace(blockRegex, fetchCode);

fs.writeFileSync(file, content);
console.log("Patched LocalAgent.ts");
