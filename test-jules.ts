import { julesApi } from './src/lib/julesApi.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const apiKey = process.env.JULES_API_KEY || 'test-key';
  try {
    const session = await julesApi.createSession(apiKey, {
      title: 'Test Session',
      prompt: 'Test prompt',
      requirePlanApproval: true,
    });
    console.log('Created session:', session);
    
    const getRes = await julesApi.getSession(apiKey, session.name);
    console.log('Got session:', getRes);
    
    const actRes = await julesApi.listActivities(apiKey, session.name, 10);
    console.log('Got activities:', actRes);
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
