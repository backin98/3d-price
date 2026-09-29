const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { URL, console, window: {}, document: { addEventListener() {} } };
const source = fs.readFileSync('public/admin/admin.js', 'utf8').replace('  init();', `
  globalThis.test = { state, placementOptions };
`);
vm.runInNewContext(source, context);

context.test.state.data = {
  baseline: { items: [
    { id: 'family', category: 'filaments', entityType: 'family', name: 'Bambu Lab Basic PLA', brand: 'Bambu Lab' },
    { id: 'black', category: 'filaments', entityType: 'sku', parentId: 'family', name: 'Bambu Lab Basic PLA Black', brand: 'Bambu Lab' },
    { id: 'white', category: 'filaments', entityType: 'sku', parentId: 'family', name: 'Bambu Lab Basic PLA White', brand: 'Bambu Lab' }
  ] },
  catalog: { products: [], filaments: [] }
};

let options = context.test.placementOptions({ kind: 'filament' }, {}, '');
assert.deepEqual(options.map((x) => x.id), ['baseline:family']);
assert.equal(options[0].name, 'Bambu Lab Basic PLA');

options = context.test.placementOptions({ kind: 'filament' }, { candidateId: 'baseline:black' }, '');
assert.deepEqual(options.map((x) => x.id), ['baseline:black']);
assert.equal(options[0].name, 'Bambu Lab Basic PLA');
assert.ok(!options[0].name.includes('Black'));

console.log('PASS: filament placement shows one colour-agnostic family while preserving an exact hidden SKU target.');
