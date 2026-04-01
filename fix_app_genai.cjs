const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// The initialization for GoogleGenAI is incorrectly relying on process.env.GEMINI_API_KEY
// It should use import.meta.env.VITE_GEMINI_API_KEY like we do for agentConfig, OR maybe it's not needed at all if we pass the proxy agent or use openAI?
// Wait, the API provider can be either gemini or openai.

const replacement = `      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });`;
content = content.replace('      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });', replacement);

fs.writeFileSync(file, content);
console.log("Fixed GoogleGenAI initialization in App.tsx");
