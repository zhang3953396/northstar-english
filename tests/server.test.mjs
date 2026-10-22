import assert from 'node:assert/strict';
import test from 'node:test';
import {handleRequest} from '../server.mjs';
async function request(url,method='GET'){
  const result={status:0,headers:{},body:''};
  await handleRequest({url,method},{
    writeHead(status,headers={}){result.status=status;result.headers=headers;return this},
    end(body){result.body=body==null?'':Buffer.isBuffer(body)?body.toString():body;return this}
  });
  return result;
}
test('only explicitly listed preview files are served',async()=>{
  const home=await request('/');assert.equal(home.status,200);assert.match(home.body,/Northstar/);
  assert.equal(home.headers['Permissions-Policy'],'microphone=(), camera=(), geolocation=()');
  for(const file of ['/LICENSE','/.env','/.git/config','/package.json','/docs/source-provenance.json','/adapters/tencent-soe.js','/api/tencent-soe-url','/%2e%2e/tencent-soe.local.env','/demo/%2e%2e/.env','/%2fetc/passwd'])
    assert.equal((await request(file)).status,404,file);
  assert.equal((await request('/','POST')).status,404);
  const head=await request('/','HEAD');assert.equal(head.status,200);assert.equal(head.body,'');
  assert.equal((await request('/core/storage.js')).status,200);
});
