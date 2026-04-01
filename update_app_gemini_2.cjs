const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// There are multiple places where geminiKey might be used.
// Let's do string replacement for the remaining ones.
content = content.replace(
  '  const [geminiModel, setGeminiModel] = useState(localStorage.getItem(\'geminiModel\') || \'gemini-3.1-flash-preview\');',
  '  const [geminiModel, setGeminiModel] = useState(localStorage.getItem(\'geminiModel\') || \'gemini-3.1-flash-preview\');\n  const [geminiKey, setGeminiKey] = useState(localStorage.getItem(\'geminiKey\') || import.meta.env.VITE_GEMINI_API_KEY || \'\');'
);

content = content.replace(
  '        geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\',',
  '        geminiApiKey: geminiKey,'
);

content = content.replace(
  '        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\' });',
  '        const ai = new GoogleGenAI({ apiKey: geminiKey });'
);

content = content.replace(
  '        const aiAgent = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\' });',
  '        const aiAgent = new GoogleGenAI({ apiKey: geminiKey });'
);

content = content.replace(
  '    apiProvider: string,\n    geminiModel: string,\n    openaiUrl: string,\n    openaiKey: string,\n    openaiModel: string,\n    proxyUrl: string\n  ) => {',
  '    apiProvider: string,\n    geminiModel: string,\n    geminiKey: string,\n    openaiUrl: string,\n    openaiKey: string,\n    openaiModel: string,\n    proxyUrl: string\n  ) => {'
);

content = content.replace(
  '    setGeminiModel(geminiModel);\n    localStorage.setItem(\'geminiModel\', geminiModel);',
  '    setGeminiModel(geminiModel);\n    localStorage.setItem(\'geminiModel\', geminiModel);\n    setGeminiKey(geminiKey);\n    localStorage.setItem(\'geminiKey\', geminiKey);'
);

fs.writeFileSync(file, content);
console.log("Updated App.tsx with all geminiKey states");
