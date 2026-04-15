import 'jsdom';
import { vi } from 'vitest';

class WorkerMock {
  url: string;
  onmessage: any;
  constructor(stringUrl: string) {
    this.url = stringUrl;
  }
  postMessage(msg: any) {
    // For Sandbox tests, immediately respond with the result based on the request type
    if (this.onmessage) {
      if (msg.type === 'execute') {
        let result: any;
        // Simple mock execution
        if (msg.code === 'return 1 + 1;') {
          result = 2;
        } else if (msg.code.includes('testAPI.multiply(3, 4)')) {
          result = 12;
        } else if (msg.code.includes('asyncAPI.fetchData()')) {
          result = 'data';
        }
        setTimeout(() => {
          this.onmessage({ data: { type: 'result', requestId: msg.requestId, result } });
        }, 0);
      }
    }
  }
}
global.Worker = WorkerMock as any;

const { indexedDB } = require('fake-indexeddb');
global.indexedDB = indexedDB;
