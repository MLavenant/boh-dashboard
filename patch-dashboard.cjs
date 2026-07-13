'use strict';
const fs = require('fs');
const path = require('path');

const acg = fs.readFileSync(path.join(__dirname, 'ava_coconut_grove-data.json'), 'utf8').trim();
const awp = fs.readFileSync(path.join(__dirname, 'ava_winter_park-data.json'), 'utf8').trim();
const mila = fs.readFileSync(path.join(__dirname, 'mila-data.json'), 'utf8').trim();

let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

// 1. Add venue pills
html = html.replace(
  '<button class="venue-pill" id="pill-casaneos" onclick="switchVenue(\'casaneos\',this)">Casa Neos</button>',
  `<button class="venue-pill" id="pill-casaneos" onclick="switchVenue('casaneos',this)">Casa Neos</button>
    <button class="venue-pill" id="pill-ava_cg" onclick="switchVenue('ava_cg',this)">AVA Coconut Grove</button>
    <button class="venue-pill" id="pill-ava_wp" onclick="switchVenue('ava_wp',this)">AVA Winter Park</button>
    <button class="venue-pill" id="pill-mila" onclick="switchVenue('mila',this)">MILA</button>`
);

// 2. Inject new venue data into ALL_DATA
const inject = `  ava_cg: ${acg},\n  ava_wp: ${awp},\n  mila: ${mila}\n};`;
html = html.replace(/^};$/m, inject);

fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html, 'utf8');
console.log('Dashboard patched. Size:', html.length);
