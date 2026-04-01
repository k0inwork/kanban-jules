const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add state for geminiKey
content = content.replace(
  '  const [geminiModel, setGeminiModel] = useState(localStorage.getItem(\'geminiModel\') || \'gemini-3.1-flash-preview\');',
  '  const [geminiModel, setGeminiModel] = useState(localStorage.getItem(\'geminiModel\') || \'gemini-3.1-flash-preview\');\n  const [geminiKey, setGeminiKey] = useState(localStorage.getItem(\'geminiKey\') || import.meta.env.VITE_GEMINI_API_KEY || \'\');'
);

// 2. Update agentConfig in handleReviewProject
content = content.replace(
  'geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\'',
  'geminiApiKey: geminiKey'
);

// Update ai instance in handleReviewProject
content = content.replace(
  '      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\' });',
  '      const ai = new GoogleGenAI({ apiKey: geminiKey });'
);

// 3. Update agentConfig in processTask
content = content.replace(
  '          geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\',',
  '          geminiApiKey: geminiKey,'
);

// Update ai instance in processTask (TaskRouter usage)
content = content.replace(
  '        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\' });',
  '        const ai = new GoogleGenAI({ apiKey: geminiKey });'
);

// Update ai instance in processTask (LocalAgent usage)
content = content.replace(
  '        const aiAgent = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\' });',
  '        const aiAgent = new GoogleGenAI({ apiKey: geminiKey });'
);


// 4. Update handleSaveSettings signature and body
content = content.replace(
  '    apiProvider: string,\n    geminiModel: string,\n    openaiUrl: string,\n    openaiKey: string,\n    openaiModel: string,\n    proxyUrl: string',
  '    apiProvider: string,\n    geminiModel: string,\n    geminiKey: string,\n    openaiUrl: string,\n    openaiKey: string,\n    openaiModel: string,\n    proxyUrl: string'
);

content = content.replace(
  '    setGeminiModel(geminiModel);\n    localStorage.setItem(\'geminiModel\', geminiModel);',
  '    setGeminiModel(geminiModel);\n    localStorage.setItem(\'geminiModel\', geminiModel);\n    setGeminiKey(geminiKey);\n    localStorage.setItem(\'geminiKey\', geminiKey);'
);

// 5. Update SettingsModal props in JSX
content = content.replace(
  '        initialGeminiModel={geminiModel}',
  '        initialGeminiModel={geminiModel}\n        initialGeminiKey={geminiKey}'
);

fs.writeFileSync(file, content);
console.log("Updated App.tsx with geminiKey state");
