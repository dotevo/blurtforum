const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'public/locales');
const srcDir = path.join(__dirname, 'src');

const locales = ['en', 'pl', 'eo'];
const translations = {};

// Load translations
locales.forEach(lang => {
  const filePath = path.join(localesDir, `${lang}.json`);
  if (fs.existsSync(filePath)) {
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
});

const usedKeys = new Set();
const missingKeys = {};
const hardcodedStrings = [];

function walk(dir, callback) {
  fs.readdirSync(dir).forEach( f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
  });
};

const tRegex = /\bt\(['"]([^'"]+)['"]\)/g;
// Heuristic for hardcoded strings in Vue templates:
// Look for text between tags that has at least one letter and isn't a variable/t() call.
const vueTemplateRegex = /<template>([\s\S]*?)<\/template>/;
const textNodeRegex = />([^<>{}\n\r\t]+)</g;

const ignoreKeys = new Set(['#', '/', ':', '.', ' ', '|', '\n', ',']);

walk(srcDir, (filePath) => {
  if (!filePath.endsWith('.vue') && !filePath.endsWith('.ts')) return;
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Find t() calls
  let match;
  while ((match = tRegex.exec(content)) !== null) {
    const key = match[1];
    if (key.length < 2 || key.includes('/') || key.includes('.') || ignoreKeys.has(key)) continue;
    usedKeys.add(key);
    locales.forEach(lang => {
      if (translations[lang] && !translations[lang][key]) {
        if (!missingKeys[lang]) missingKeys[lang] = new Set();
        missingKeys[lang].add(key);
      }
    });
  }

  // Find hardcoded strings in Vue templates
  if (filePath.endsWith('.vue')) {
    const templateMatch = content.match(vueTemplateRegex);
    if (templateMatch) {
      const template = templateMatch[1];
      let tNodeMatch;
      while ((tNodeMatch = textNodeRegex.exec(template)) !== null) {
        const text = tNodeMatch[1].trim();
        if (text && /[a-zA-Z]/.test(text) && !text.includes('{{')) {
           hardcodedStrings.push({ file: path.relative(__dirname, filePath), text });
        }
      }
    }
  }
});

console.log('=== TRANSLATION AUDIT ===\n');

console.log('--- Missing Translations ---');
locales.forEach(lang => {
  if (missingKeys[lang] && missingKeys[lang].size > 0) {
    console.log(`\n[${lang.toUpperCase()}] Missing keys:`);
    missingKeys[lang].forEach(key => console.log(`  - ${key}`));
  } else {
    console.log(`\n[${lang.toUpperCase()}] No missing keys.`);
  }
});

console.log('\n--- Unused Translations (in en.json) ---');
const enKeys = Object.keys(translations['en'] || {});
let unusedCount = 0;
enKeys.forEach(key => {
  if (!usedKeys.has(key)) {
    console.log(`  - ${key}`);
    unusedCount++;
  }
});
if (unusedCount === 0) console.log('  None.');

console.log('\n--- Potential Hardcoded Strings (Vue Templates) ---');
if (hardcodedStrings.length > 0) {
  hardcodedStrings.slice(0, 50).forEach(item => {
    console.log(`  [${item.file}] ${item.text}`);
  });
  if (hardcodedStrings.length > 50) console.log(`  ... and ${hardcodedStrings.length - 50} more.`);
} else {
  console.log('  None found.');
}
