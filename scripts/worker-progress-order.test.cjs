const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const calls = [];
  let progressCalls = 0;
  const context = {
    require(id) {
      if (id === '../lib/qwen-website-job.cjs') return {
        runWebsiteJob: async (_opts, emit) => {
          for (let i = 0; i < 12; i += 1) emit({ type: 'log', text: 'event ' + i });
          return { candidateFile: '' };
        }
      };
      return require(id);
    },
    __dirname: path.resolve('worker'),
    process: { env: { INGEST_TOKEN: 'test-token-long-enough', ONLINE_URL: 'https://example.com', ONLINE_CATALOG_FILE: path.join(os.tmpdir(), 'worker-progress-order.json') }, on() {} },
    console: { log() {}, warn() {}, error() {} },
    AbortController, AbortSignal, setInterval: () => 1, clearInterval() {}, setTimeout,
    fetch: async (url) => {
      const text = String(url);
      if (text.includes('action=catalog')) return { ok: true, json: async () => ({ catalog: { products: [], filaments: [] }, baseline: { items: [] } }) };
      if (text.includes('action=progress')) {
        progressCalls += 1;
        if (progressCalls > 1) {
          calls.push('progress-start');
          await new Promise((resolve) => setTimeout(resolve, 40));
          calls.push('progress-end');
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (text.includes('action=complete')) calls.push('complete');
      return { ok: true, json: async () => ({ ok: true }) };
    }
  };
  const source = fs.readFileSync('worker/online-worker.cjs', 'utf8')
    .replace(/main\(\)\.catch\([\s\S]*$/, 'globalThis.run = runClaimedJob; globalThis.compact = compactEvent;');
  vm.runInNewContext(source, context);
  assert.equal(context.compact({ type: 'extract', url: 'https://shop.example/p', error: 'out_of_stock' }).error, 'out_of_stock');
  await context.run({ id: 'job', url: 'https://example.com/list', kind: 'printer' }, { shops: [] });
  assert.deepEqual(calls, ['progress-start', 'progress-end', 'complete']);
  console.log('PASS: final completion waits for every in-flight progress upload.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
