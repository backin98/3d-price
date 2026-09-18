const assert = require('node:assert/strict');
const { parseMoney, withVat, pickPrice } = require('../lib/parse-money.cjs');

assert.equal(parseMoney('1.250,00 TL'), 1250);
assert.equal(parseMoney('1,250.00'), 1250);
assert.equal(parseMoney('12.50'), 12.5);
assert.equal(parseMoney('12,50'), 12.5);
assert.equal(parseMoney('1.250'), 1250);
assert.equal(parseMoney(1250), 1250);
assert.equal(withVat(100, 'excluded'), 120);
assert.equal(withVat(19999, 'excluded'), 23998.8);
assert.equal(withVat(100, 'included'), 100);
assert.equal(pickPrice('<div class="yeni-fiyat">1.000,00 TL</div><del>1.200,00</del>', '1.200,00').price, 1000);
assert.equal(pickPrice('<div class="yeni-fiyat">1.000,00 TL</div><del>1.200,00</del>', '1.200,00').was, 1200);
assert.equal(pickPrice('<div class="sale-price">10.000,00 TL</div><span>+ KDV</span>').plusVat, true);
assert.equal(pickPrice('<div class="sale-price">10.000,00 TL</div><span>KDV Dahil</span>').plusVat, false);
console.log('PASS: TR/US separators, VAT, sale vs struck-through list price.');
