'use strict';
// Loads the generated browser data files (window.X = {...};) in Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadWindowData(rel) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), ctx);
  return ctx.window;
}

module.exports = { loadWindowData };
