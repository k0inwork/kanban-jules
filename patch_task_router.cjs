const fs = require('fs');

const file = 'src/services/TaskRouter.ts';
let content = fs.readFileSync(file, 'utf8');

const fetchCode = `
      let url = \`\${config.openaiUrl}/chat/completions\`;
      let fetchArgs: any = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${config.openaiKey}\`
        },
        body: JSON.stringify({
          model: config.openaiModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        })
      };

      if (config.proxyUrl) {
        url = '/api/proxy';
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: \`\${config.openaiUrl}/chat/completions\`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${config.openaiKey}\`
            },
            body: {
              model: config.openaiModel,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1
            },
            proxyUrl: config.proxyUrl
          })
        };
      }

      const response = await fetch(url, fetchArgs);
      if (response.ok) {
        const data = await response.json();
        const responseData = config.proxyUrl ? data.data : data;
        responseText = responseData.choices[0].message.content || '';
      }
`;

const blockStart = `    const response = await fetch(\`\${config.openaiUrl}/chat/completions\`, {`;
const blockEnd = `      responseText = data.choices[0].message.content || '';\n    }`;

const blockRegex = new RegExp(
  blockStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + blockEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

content = content.replace(blockRegex, fetchCode);
fs.writeFileSync(file, content);
console.log("Patched TaskRouter.ts");
