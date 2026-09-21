// Baseline axes: the two catalog-index functions that take a brandId first.
//
// `feederOf` and `technologyOf` are `(brandId, title)`. baseline-catalog.js called both with the
// arguments reversed, and the damage was silent:
//   - feederOf(text, brand) always returned null, so every baseline row lost its feeder generation
//     ("P1S AMS 2 Pro" read as a bare machine) and hard-conflict checks on feeders were meaningless.
//   - technologyOf(text) returns "fdm" for EVERYTHING, so a 10W or 40W laser machine was classified as
//     FDM. That makes a laser and a non-laser look like the same technology.
//
// Verified against the functions directly before fixing: the right order gives {id:"ams-2-pro"} and
// "laser"; the wrong order gives null and "fdm".
const assert = require('node:assert/strict');
const baseline = require('../lib/baseline-catalog.js');

const axes = (title, brand) => baseline.extractAxes(title, { brand });

// feeder generation survives, in the spelling shops actually use.
const p1s = axes('Bambu Lab P1S AMS 2 Pro Combo 3D Yazıcı', 'bambu');
assert.equal(p1s.feederGen, 'ams-2-pro', 'AMS 2 Pro must be read as the feeder generation, got ' + JSON.stringify(p1s.feederGen));
assert.equal(p1s.comboAxis, 'combo', 'a named feeder means combo');

// A bare machine still has no feeder.
const bare = axes('Bambu Lab P1S 3D Yazıcı', 'bambu');
assert.equal(bare.feederGen, '', 'no feeder named, no feeder generation');
assert.equal(bare.comboAxis, 'bare', 'a bare machine stays bare');

// technology: real laser rows from the live catalogue must not be FDM.
assert.equal(axes('Bambu Lab H2D Laser Combo 3D Printer 40W', 'bambu').technology, 'laser', 'a laser machine is not fdm');
assert.equal(axes('Bambu Lab H2C Lazer Full Combo 10W 3D Yazıcı', 'bambu').technology, 'laser', 'the Turkish spelling too');
assert.equal(axes('Bambu Lab P1S 3D Yazıcı', 'bambu').technology, 'fdm', 'a plain printer is still fdm');

// And the two must disagree in the way that keeps a laser SKU separate from the plain machine.
assert.notEqual(
  axes('Bambu Lab H2C Lazer Full Combo 10W 3D Yazıcı', 'bambu').technology,
  axes('Bambu Lab H2C 3D Yazıcı', 'bambu').technology,
  'a laser H2C and a plain H2C are different technology'
);

console.log('PASS: feederGen reads AMS 2 Pro (arguments the right way round) and laser machines are not');
console.log('      classified as FDM, while bare machines keep no feeder.');
