const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'geminiApiKey: process.env.GEMINI_API_KEY || \'\'',
  'geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || \'\''
);

fs.writeFileSync(file, content);
console.log("Fixed App.tsx gemini API key initialization");
