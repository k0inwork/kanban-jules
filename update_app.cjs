const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  'const [openaiModel, setOpenaiModel] = useState(() => localStorage.getItem(\'openaiModel\') || \'gpt-4o\');',
  "const [openaiModel, setOpenaiModel] = useState(() => localStorage.getItem('openaiModel') || 'gpt-4o');\n  const [notebooklmCookie, setNotebooklmCookie] = useState(() => localStorage.getItem('notebooklmCookie') || '');"
);

content = content.replace(
  'provider: string,\n    gModel: string,\n    oUrl: string,\n    oKey: string,\n    oModel: string\n  ) => {',
  'provider: string,\n    gModel: string,\n    oUrl: string,\n    oKey: string,\n    oModel: string,\n    nbCookie: string\n  ) => {'
);

content = content.replace(
  'setOpenaiModel(oModel);',
  'setOpenaiModel(oModel);\n    setNotebooklmCookie(nbCookie);'
);

content = content.replace(
  'localStorage.setItem(\'openaiModel\', oModel);',
  'localStorage.setItem(\'openaiModel\', oModel);\n    localStorage.setItem(\'notebooklmCookie\', nbCookie);'
);

content = content.replace(
  'initialOpenaiModel={openaiModel}\n      />',
  'initialOpenaiModel={openaiModel}\n        initialNotebooklmCookie={notebooklmCookie}\n      />'
);

fs.writeFileSync('src/App.tsx', content);
