const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// The proxy state wasn't added properly, lets rewrite using split and splice
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const [openaiModel, setOpenaiModel] = useState')) {
    if (!lines[i+1].includes('proxyUrl')) {
      lines.splice(i + 1, 0, '  const [proxyUrl, setProxyUrl] = useState(localStorage.getItem(\'proxyUrl\') || \'\');');
    }
    break;
  }
}

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('openaiKey: string,')) {
    if (!lines[i+2].includes('proxyUrl')) {
      lines.splice(i + 2, 0, '    proxyUrl: string');
    }
    break;
  }
}

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('localStorage.setItem(\'openaiModel\', openaiModel);')) {
    if (!lines[i+1].includes('proxyUrl')) {
      lines.splice(i + 1, 0, '    setProxyUrl(proxyUrl);\n    localStorage.setItem(\'proxyUrl\', proxyUrl);');
    }
    break;
  }
}

// Remove duplicate initialProxyUrl prop
let firstFound = false;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('initialProxyUrl={proxyUrl}')) {
    if (firstFound) {
      lines.splice(i, 1);
    } else {
      firstFound = true;
    }
  }
}


fs.writeFileSync(file, lines.join('\n'));
console.log("Fixed App.tsx state");
