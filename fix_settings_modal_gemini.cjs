const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

// Update Props
content = content.replace(
  'initialGeminiModel: string;',
  'initialGeminiModel: string;\n  initialGeminiKey: string;'
);

content = content.replace(
  'geminiModel: string,',
  'geminiModel: string,\n    geminiKey: string,'
);

content = content.replace(
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl',
  'initialApiProvider, initialGeminiModel, initialGeminiKey, initialOpenaiUrl'
);

// Add State
content = content.replace(
  'const [geminiModel, setGeminiModel] = useState(initialGeminiModel);',
  'const [geminiModel, setGeminiModel] = useState(initialGeminiModel);\n  const [geminiKey, setGeminiKey] = useState(initialGeminiKey);'
);

// Update useEffect 1
content = content.replace(
  'setGeminiModel(initialGeminiModel);',
  'setGeminiModel(initialGeminiModel);\n      setGeminiKey(initialGeminiKey);'
);

// Update useEffect dependencies
content = content.replace(
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl',
  'initialApiProvider, initialGeminiModel, initialGeminiKey, initialOpenaiUrl'
);

// Update handleSave call
content = content.replace(
  'apiProvider, geminiModel, openaiUrl',
  'apiProvider, geminiModel, geminiKey, openaiUrl'
);

// Update JSX
const jsxOld = `<label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Gemini Model</label>
                <select`;
const jsxNew = `<div>
                  <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Gemini API Key</label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    className="w-full mb-3 bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="AIzaSy..."
                  />
                </div>
                <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Gemini Model</label>
                <select`;
content = content.replace(jsxOld, jsxNew);

fs.writeFileSync(file, content);
console.log("Fixed SettingsModal.tsx for GeminiKey");
