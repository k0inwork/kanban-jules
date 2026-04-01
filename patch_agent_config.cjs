const fs = require('fs');
const file = 'src/services/LocalAgent.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '  openaiModel: string;',
  '  openaiModel: string;\n  proxyUrl?: string;'
);

fs.writeFileSync(file, content);
console.log("Patched LocalAgent.ts");
