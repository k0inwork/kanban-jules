const fs = require('fs');

// Fix LocalAgent.ts
let laContent = fs.readFileSync('src/services/LocalAgent.ts', 'utf8');
laContent = laContent.replace(/  proxyUrl\?: string;\n  proxyUrl\?: string;/g, '  proxyUrl?: string;');
fs.writeFileSync('src/services/LocalAgent.ts', laContent);
console.log("Fixed LocalAgent.ts duplicate types");

// Fix App.tsx SettingsModal props
let appContent = fs.readFileSync('src/App.tsx', 'utf8');
const oldAppSave = `          setOpenaiModel(oModel);
          localStorage.setItem('openaiModel', oModel);
        }}`;
const newAppSave = `          setOpenaiModel(oModel);
          localStorage.setItem('openaiModel', oModel);
        }}`;

// Wait, the error is that SettingsModal is missing initialProxyUrl from Props.
// But we supposedly added it in SettingsModal.tsx. Let's check SettingsModal.tsx
