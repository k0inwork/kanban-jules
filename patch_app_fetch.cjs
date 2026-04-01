const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// The fetch logic in App.tsx supervisor step
const fetchCode = `
        let url = \`\${openaiUrl}/chat/completions\`;
        let fetchArgs: any = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${openaiKey}\`
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [{ role: 'user', content: prompt }]
          })
        };

        const proxyUrl = localStorage.getItem('proxyUrl') || '';
        if (proxyUrl) {
          url = '/api/proxy';
          fetchArgs = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: \`\${openaiUrl}/chat/completions\`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': \`Bearer \${openaiKey}\`
              },
              body: {
                model: openaiModel,
                messages: [{ role: 'user', content: prompt }]
              },
              proxyUrl: proxyUrl
            })
          };
        }

        const response = await fetch(url, fetchArgs);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(\`OpenAI API error: \${data.error?.message || response.statusText}\`);
        }

        const responseData = proxyUrl ? data.data : data;
        const answer = responseData.choices[0].message.content;
`;

const blockStart = `        const response = await fetch(\`\${openaiUrl}/chat/completions\`, {`;
const blockEnd = `        const answer = data.choices[0].message.content;`;

const blockRegex = new RegExp(
  blockStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + blockEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

content = content.replace(blockRegex, fetchCode);
fs.writeFileSync(file, content);
console.log("Patched App.tsx fetch");
