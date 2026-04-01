const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'initialOpenaiModel: string;',
  'initialOpenaiModel: string;\n  initialProxyUrl?: string;'
);

content = content.replace(
  'openaiModel: string\n  ) => void;',
  'openaiModel: string,\n    proxyUrl: string\n  ) => void;'
);

content = content.replace(
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel\n}: SettingsModalProps) {',
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel, initialProxyUrl\n}: SettingsModalProps) {'
);

fs.writeFileSync(file, content);
console.log("Fixed SettingsModal.tsx");
