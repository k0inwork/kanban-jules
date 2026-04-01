const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel\n    );',
  'apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel, proxyUrl\n    );'
);

fs.writeFileSync(file, content);
console.log("Fixed SettingsModal.tsx onSave invocation");
