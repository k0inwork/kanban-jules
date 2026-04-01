const fs = require('fs');

const file = 'src/services/ProcessAgent.ts';
let content = fs.readFileSync(file, 'utf8');

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
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
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
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            },
            proxyUrl: this.config.proxyUrl
          })
        };
      }

      const response = await fetch(url, fetchArgs);
      const data = await response.json();
      const responseData = this.config.proxyUrl ? data.data : data;
      responseText = responseData.choices[0].message.content || '{}';
`;

const blockStart = `        const response = await fetch(\`\${this.config.openaiUrl}/chat/completions\`, {`;
const blockEnd = `        responseText = data.choices[0].message.content || '{}';`;

const blockRegex = new RegExp(
  blockStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + blockEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

content = content.replace(blockRegex, fetchCode);
fs.writeFileSync(file, content);
console.log("Patched ProcessAgent.ts");
