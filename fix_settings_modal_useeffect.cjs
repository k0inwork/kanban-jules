const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

// The proxyUrl is not being updated when the modal opens because it's missing from the useEffect block
content = content.replace(
  '      setOpenaiModel(initialOpenaiModel);\n    }\n  }, [',
  '      setOpenaiModel(initialOpenaiModel);\n      setProxyUrl(initialProxyUrl || \'\');\n    }\n  }, ['
);

content = content.replace(
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel\n  ]);',
  'initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel, initialProxyUrl\n  ]);'
);

fs.writeFileSync(file, content);
console.log("Fixed SettingsModal.tsx useEffect");
