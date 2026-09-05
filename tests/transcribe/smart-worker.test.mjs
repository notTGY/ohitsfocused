/** Actual production smart-worker source; ONLY the runtime/GPU are simulated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const mockURL = new URL('mock-smart-runtime.js', import.meta.url).href;
const helpers = (await read('../../src/lib/transcribe/core.js')).replace(/^export /gm, '').replace(/const SMART_TRANSFORMERS_URL = '[^']+';/, `const SMART_TRANSFORMERS_URL = ${JSON.stringify(mockURL)};`);
const source = (await read('../../src/lib/transcribe/smart-worker.js')).replace(/^import .* from '\.\/core\.js';\n/m, '');
function createWorker(supported = true) {
  const adapter = `import { parentPort } from 'node:worker_threads';
  globalThis.self = globalThis;
  Object.defineProperty(globalThis, 'navigator', {value: {gpu:{requestAdapter:async()=>({features:new Set(${supported ? "['shader-f16']" : '[]'})})}}, configurable:true});
  self.addEventListener = (_type, listener) => parentPort.on('message', data => listener({data}));
  self.postMessage = data => parentPort.postMessage(data);\n`;
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter+helpers+'\n'+source)}`));
}
function run(worker, id, text, language='en') {
  return new Promise((resolve, reject) => {
    const messages=[];
    const timer=setTimeout(()=>{cleanup();reject(new Error('Smart worker timed out'));},8000);
    const error=e=>{cleanup();reject(e);};
    const message=data=>{if(data.id!==id)return;messages.push(data);if(data.type==='complete'||data.type==='error'){cleanup();resolve({result:data,messages});}};
    function cleanup(){clearTimeout(timer);worker.off('message',message);worker.off('error',error);}
    worker.on('message',message); worker.on('error',error);
    worker.postMessage({type:'refine',id,text,language});
  });
}
test('S1 worker validates English, config, model revision, prompts, thinking flag and external-data progress', async () => {
  const worker=createWorker();
  try {
    const {result,messages}=await run(worker,1,'so um send it on friday no wait thursday');
    assert.equal(result.type,'complete', result.detail); assert.equal(result.text,'send it on Thursday');
    assert.ok(messages.some(m=>m.type==='download'&&m.loaded===100),'external .onnx_data progress');
    assert.ok(messages.some(m=>m.type==='download'&&m.percent===50),'aggregate progress');
    assert.equal((await run(worker,2,'bonjour','fr')).result.type,'error');
  } finally {await worker.terminate();}
});
test('S1 worker treats filler-only empty output as valid and errors separately', async () => {
  const worker=createWorker();
  try {
    const empty=(await run(worker,1,'um')).result;
    assert.equal(empty.type,'complete');assert.equal(empty.text,'');
    const error=(await run(worker,2,'FAIL_TEST')).result;
    assert.equal(error.type,'error');assert.equal(error.stage,'inference');
  } finally {await worker.terminate();}
});
test('S1 worker normalizes multiple bounded chunks without losing text and retains truncated originals', async () => {
  const worker=createWorker();
  try {
    const raw=Array.from({length:2000},(_,i)=>`word${i}`).join(' ');
    const long=await run(worker,1,raw);
    assert.equal(long.result.type,'complete');
    assert.equal(long.result.text.replace(/\s+/g,' '),raw);
    assert.equal(long.messages.filter(m=>m.type==='progress').at(-1).completed,3);
    const cut=(await run(worker,2,'TRUNCATE_TEST retain this original')).result;
    assert.equal(cut.text,'TRUNCATE_TEST retain this original');
    assert.equal(cut.preservedChunks,1);
  } finally {await worker.terminate();}
});
test('S1 worker refuses missing shader-f16 before attempting any model download', async () => {
  const worker=createWorker(false);
  try {
    const {result,messages}=await run(worker,1,'hello');
    assert.equal(result.type,'error');assert.equal(result.stage,'load');
    assert.ok(!messages.some(m=>m.type==='download'));
  } finally {await worker.terminate();}
});
