const fs = require('fs');
const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const [geminiModel, setGeminiModel] = useState')) {
    if (!lines[i+1].includes('geminiKey')) {
      lines.splice(i + 1, 0, '  const [geminiKey, setGeminiKey] = useState(localStorage.getItem(\'geminiKey\') || import.meta.env.VITE_GEMINI_API_KEY || \'\');');
    }
    break;
  }
}

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY')) {
    lines[i] = lines[i].replace('import.meta.env.VITE_GEMINI_API_KEY || \'\'', 'geminiKey');
  }
  if (lines[i].includes('apiKey: import.meta.env.VITE_GEMINI_API_KEY')) {
    lines[i] = lines[i].replace('import.meta.env.VITE_GEMINI_API_KEY || \'\'', 'geminiKey');
  }
}

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('geminiModel: string,')) {
    if (!lines[i+1].includes('geminiKey')) {
      lines.splice(i + 1, 0, '    geminiKey: string,');
    }
    break;
  }
}

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('localStorage.setItem(\'geminiModel\', geminiModel);')) {
    if (!lines[i+1].includes('geminiKey')) {
      lines.splice(i + 1, 0, '    setGeminiKey(geminiKey);\n    localStorage.setItem(\'geminiKey\', geminiKey);');
    }
    break;
  }
}

fs.writeFileSync(file, lines.join('\n'));
console.log("Fixed App.tsx gemini dependencies");
