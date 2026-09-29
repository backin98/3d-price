"use strict";

// Named filament colours with their swatch hex, for the admin colour dot and the image colour picker.
const { colours } = require("../data/filament-taxonomy.json");

module.exports = Object.fromEntries(Object.entries(colours || {}).map(([id, c]) => [id, { name: c.name, hex: c.hex, aliases: c.aliases || [] }]));
