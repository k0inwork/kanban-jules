const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '  const [openaiModel, setOpenaiModel] = useState(initialOpenaiModel);',
  '  const [openaiModel, setOpenaiModel] = useState(initialOpenaiModel);\n  const [proxyUrl, setProxyUrl] = useState(initialProxyUrl || \'\');'
);

fs.writeFileSync(file, content);
console.log("Fixed SettingsModal.tsx state");
