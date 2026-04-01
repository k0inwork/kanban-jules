const fs = require('fs');

const file = 'src/services/LocalAgent.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /private async callLlm\([\s\S]*?async runTask/m;

const replacement = `private async callLlm(contents: any[]): Promise<string> {
    if (this.config.apiProvider === 'gemini') {
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: contents,
      });
      return response.text || '';
    } else {
      // OpenAI compatible
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
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            method: fetchArgs.method,
            headers: fetchArgs.headers,
            body: JSON.parse(fetchArgs.body),
            proxyUrl: this.config.proxyUrl
          })
        };
        url = '/api/proxy';
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
  }

  async runTask`;

content = content.replace(regex, replacement);
fs.writeFileSync(file, content);
console.log("Fixed LocalAgent.ts cleanly");
