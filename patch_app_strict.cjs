const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// The App.tsx modifications were overwritten or incomplete.
// Let's do it precisely via line by line or robust regex

content = content.replace(
  '  const [openaiModel, setOpenaiModel] = useState(localStorage.getItem(\'openaiModel\') || \'gpt-4o\');',
  '  const [openaiModel, setOpenaiModel] = useState(localStorage.getItem(\'openaiModel\') || \'gpt-4o\');\n  const [proxyUrl, setProxyUrl] = useState(localStorage.getItem(\'proxyUrl\') || \'\');'
);

content = content.replace(
  '      const agentConfig: AgentConfig = {\n        apiProvider,\n        geminiModel,\n        geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\',\n        openaiUrl,\n        openaiKey,\n        openaiModel\n      };',
  '      const agentConfig: AgentConfig = {\n        apiProvider,\n        geminiModel,\n        geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\',\n        openaiUrl,\n        openaiKey,\n        openaiModel,\n        proxyUrl\n      };'
);

content = content.replace(
  '    openaiModel: string\n  ) => {',
  '    openaiModel: string,\n    proxyUrl: string\n  ) => {'
);

content = content.replace(
  '    setOpenaiModel(openaiModel);\n    localStorage.setItem(\'openaiModel\', openaiModel);',
  '    setOpenaiModel(openaiModel);\n    localStorage.setItem(\'openaiModel\', openaiModel);\n    setProxyUrl(proxyUrl);\n    localStorage.setItem(\'proxyUrl\', proxyUrl);'
);

content = content.replace(
  '        initialOpenaiModel={openaiModel}',
  '        initialOpenaiModel={openaiModel}\n        initialProxyUrl={proxyUrl}'
);

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

        const proxyUrlVal = localStorage.getItem('proxyUrl') || '';
        if (proxyUrlVal) {
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
              proxyUrl: proxyUrlVal
            })
          };
        }

        const response = await fetch(url, fetchArgs);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(\`OpenAI API error: \${data.error?.message || response.statusText}\`);
        }

        const responseData = proxyUrlVal ? data.data : data;
        const answer = responseData.choices[0].message.content;
`;

const blockStart = `        const response = await fetch(\`\${openaiUrl}/chat/completions\`, {`;
const blockEnd = `        const answer = data.choices[0].message.content;`;

const blockRegex = new RegExp(
  blockStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + blockEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

content = content.replace(blockRegex, fetchCode);

fs.writeFileSync(file, content);
console.log("Patched App.tsx strict");
