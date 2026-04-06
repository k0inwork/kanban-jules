import { registry } from './core/registry';
import { composeArchitectPrompt } from './core/prompt';

console.log('Testing Module Registry...');
const modules = registry.getAll();
console.log(`Found ${modules.length} modules.`);

modules.forEach(m => {
  console.log(`- Module: ${m.name} (${m.id})`);
});

console.log('\nTesting Prompt Composition...');
const prompt = composeArchitectPrompt(modules);
console.log(prompt);
