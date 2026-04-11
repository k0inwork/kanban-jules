import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web/index.js';
import FS from '@isomorphic-git/lightning-fs';

const fs = new FS('test-repo');
const pfs = fs.promises;

async function test() {
  const dir = '/test';
  try {
    await pfs.mkdir(dir);
  } catch (e) {}
  
  console.log('Cloning...');
  await git.clone({
    fs,
    http,
    dir,
    url: 'https://github.com/isomorphic-git/isomorphic-git',
    corsProxy: 'https://cors.isomorphic-git.org',
    depth: 1,
    singleBranch: true
  });
  
  console.log('Cloned!');
  const files = await pfs.readdir(dir);
  console.log('Files:', files);
}

test().catch(console.error);
