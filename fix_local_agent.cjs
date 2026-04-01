const fs = require('fs');

const file = 'src/services/LocalAgent.ts';
let content = fs.readFileSync(file, 'utf8');

// There's a messy block around line 85 where I inserted fetch code. I will rewrite callLlm function cleanly.
const callLlmStart = `  async callLlm(contents: any[]): Promise<string> {`;
const callLlmEnd = `    }\n  }`;

const regex = new RegExp(
  callLlmStart.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + callLlmEnd.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
);

const cleanCallLlm = `  async callLlm(contents: any[]): Promise<string> {
    if (this.config.apiProvider === 'gemini') {
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: contents,
      });
      return response.text || '';
    } else {
      // OpenAI compatible
      if (!this.config.openaiKey) throw new Error("OpenAI API Key is missing.");

      const messages = contents.map(c => ({
        role: c.role === 'model' ? 'assistant' : c.role,
        content: c.parts[0].text
      }));

      let url = \`\${this.config.openaiUrl}/chat/completions\`;
      let fetchArgs: any = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${this.config.openaiKey}\`
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          messages: messages,
          temperature: 0.1
        })
      };

      if (this.config.proxyUrl) {
        url = '/api/proxy';
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: \`\${this.config.openaiUrl}/chat/completions\`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${this.config.openaiKey}\`
            },
            body: {
              model: this.config.openaiModel,
              messages: messages,
              temperature: 0.1
            },
            proxyUrl: this.config.proxyUrl
          })
        };
      }

      const response = await fetch(url, fetchArgs);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(\`OpenAI API error: \${errorText}\`);
      }

      const data = await response.json();
      const responseData = this.config.proxyUrl ? data.data : data;
      return responseData.choices[0].message.content || '';
    }
  }`;

content = content.replace(regex, cleanCallLlm);
fs.writeFileSync(file, content);
console.log("Fixed LocalAgent.ts");
