const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add state for proxyUrl
content = content.replace(
  '  const [openaiModel, setOpenaiModel] = useState(localStorage.getItem(\'openaiModel\') || \'gpt-4o\');',
  '  const [openaiModel, setOpenaiModel] = useState(localStorage.getItem(\'openaiModel\') || \'gpt-4o\');\n  const [proxyUrl, setProxyUrl] = useState(localStorage.getItem(\'proxyUrl\') || \'\');'
);

// 2. Add to LocalAgent configuration
content = content.replace(
  '        openaiModel',
  '        openaiModel,\n        proxyUrl'
);

// 3. Update save settings handler signature
content = content.replace(
  '    openaiKey: string,\n    openaiModel: string\n  ) => {',
  '    openaiKey: string,\n    openaiModel: string,\n    proxyUrl: string\n  ) => {'
);

// 4. Update save settings handler logic
content = content.replace(
  '    setOpenaiModel(openaiModel);\n    localStorage.setItem(\'openaiModel\', openaiModel);',
  '    setOpenaiModel(openaiModel);\n    localStorage.setItem(\'openaiModel\', openaiModel);\n    setProxyUrl(proxyUrl);\n    localStorage.setItem(\'proxyUrl\', proxyUrl);'
);

// 5. Update the SettingsModal props
content = content.replace(
  '        initialOpenaiModel={openaiModel}',
  '        initialOpenaiModel={openaiModel}\n        initialProxyUrl={proxyUrl}'
);

fs.writeFileSync(file, content);
console.log("Patched App.tsx state");
