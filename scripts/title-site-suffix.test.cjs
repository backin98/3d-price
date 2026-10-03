// A page title that ends with the shop ("… - Robotzade.com") must not turn the shop into a colour or leave it in the name:
// on a multicolour listing "Robotzade.com" was read as the colour of Bambu Lab Gradient Cotton Candy Cloud and Solid Silk Rainbow.
const assert = require('node:assert/strict');
const { withoutSiteSuffix } = require('../api/filament-classify.js');
const { normalizeFilamentListing } = require('../lib/qwen-website-job.cjs');

assert.equal(withoutSiteSuffix('Solid Silk Rainbow PLA Filament - Robotzade.com'), 'Solid Silk Rainbow PLA Filament');
assert.equal(withoutSiteSuffix('Bambu Lab PLA Basic Gradient Filament Cotton Candy Cloud 1.75mm | www.robotzade.com'), 'Bambu Lab PLA Basic Gradient Filament Cotton Candy Cloud 1.75mm');
assert.equal(withoutSiteSuffix('eSUN PLA+ Filament - Black | Filamentmarketim.com.tr'), 'eSUN PLA+ Filament - Black');
// colours, models and dashes inside the title are left alone
for (const t of ['eSUN PLA+ Filament - Black', 'Creality Ender PLA+ Filament - Beige', 'Solid Silk PLA - Dark Blue', 'Porima PETG 3Kg - Neon Yeşil']) assert.equal(withoutSiteSuffix(t), t);

const run = (title, extra) => normalizeFilamentListing({ name: title, sourceTitle: title, kind: 'filament', brand: 'Bambu Lab', url: 'https://www.robotzade.com/x', price: 900, ...extra });
let l = run('Bambu Lab PLA Basic Gradient Filament Cotton Candy Cloud 1.75mm - Robotzade.com');
assert.ok(!/robotzade/i.test(l.colorName + ' ' + l.color + ' ' + l.name), 'the shop is not the colour or the name: ' + JSON.stringify({ n: l.name, c: l.colorName, k: l.color }));
l = run('Solid Silk Rainbow PLA Filament - Robotzade.com', { brand: 'Solid' });
assert.ok(!/robotzade/i.test(l.colorName + ' ' + l.color + ' ' + l.name), 'the shop is not the colour or the name: ' + JSON.stringify({ n: l.name, c: l.colorName, k: l.color }));
assert.equal(run('eSUN PLA+ Filament - Black', { brand: 'eSUN' }).color, 'black');

console.log('PASS: a shop name at the end of a page title is dropped, so it is never read as a colour.');
