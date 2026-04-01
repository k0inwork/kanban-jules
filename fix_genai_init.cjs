const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace all instances of 'new GoogleGenAI({ apiKey: geminiKey })'
// with 'new GoogleGenAI({ apiKey: geminiKey || 'dummy_key' })'
content = content.replace(
  /new GoogleGenAI\(\{ apiKey: geminiKey \}\)/g,
  "new GoogleGenAI({ apiKey: geminiKey || 'dummy_key' })"
);

fs.writeFileSync(file, content);
console.log("Fixed GoogleGenAI instantiation");
