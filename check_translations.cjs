const fs = require('fs');
const path = require('path');

// 1. Load translations from raw file (using simple regex to extract objects)
const translationsFile = fs.readFileSync('src/modules/translations.raw.ts', 'utf8');
const languages = ['en', 'pl', 'eo'];
const dicts = {};

languages.forEach(lang => {
    const startIdx = translationsFile.indexOf(`${lang}: {`);
    if (startIdx === -1) return;
    
    // Find closing brace of the language object
    let braceCount = 1;
    let endIdx = -1;
    for (let i = startIdx + lang.length + 3; i < translationsFile.length; i++) {
        if (translationsFile[i] === '{') braceCount++;
        if (translationsFile[i] === '}') braceCount--;
        if (braceCount === 0) {
            endIdx = i;
            break;
        }
    }
    
    const objStr = translationsFile.substring(startIdx + lang.length + 2, endIdx + 1);
    // Rough parse of keys
    const keys = [];
    const keyRegex = /([a-zA-Z0-9]+):\s*["']/g;
    let match;
    while ((match = keyRegex.exec(objStr)) !== null) {
        keys.push(match[1]);
    }
    dicts[lang] = new Set(keys);
});

// 2. Scan files for t('key') or t("key")
const files = [];
function walkDir(dir) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist') walkDir(fullPath);
        } else if (file.endsWith('.vue') || file.endsWith('.ts')) {
            files.push(fullPath);
        }
    });
}
walkDir('src');

const usedKeys = new Set();
const potentialHardcoded = [];

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    
    // Find used keys: t('key') or t("key")
    const tRegex = /t\(['"]([a-zA-Z0-9]+)['"]\)/g;
    let match;
    while ((match = tRegex.exec(content)) !== null) {
        usedKeys.add(match[1]);
    }

    // Rough check for hardcoded strings in templates
    if (file.endsWith('.vue')) {
        const templateMatch = content.match(/<template>([\s\S]*)<\/template>/);
        if (templateMatch) {
            const template = templateMatch[1];
            // Find text between tags that doesn't start with {{ and doesn't look like an icon or CSS
            // This is very rough and will have many false positives, but helps
            const textRegex = />\s*([A-Z][a-z0-9 ]{2,})\s*</g;
            while ((match = textRegex.exec(template)) !== null) {
                const text = match[1].trim();
                if (text && !text.includes('fa-') && !text.startsWith('{{')) {
                    potentialHardcoded.push({ file: path.basename(file), text });
                }
            }
        }
    }
});

// 3. Report
console.log('--- TRANSLATION AUDIT ---');
console.log(`Scanned ${files.length} files. Found ${usedKeys.size} unique keys used with t().\n`);

languages.forEach(lang => {
    console.log(`[${lang.toUpperCase()}]`);
    const missingInDict = [...usedKeys].filter(k => !dicts[lang].has(k));
    const unusedInDict = [...dicts[lang]].filter(k => !usedKeys.has(k));
    
    if (missingInDict.length > 0) {
        console.log(`  Missing in dictionary (${missingInDict.length}): ${missingInDict.join(', ')}`);
    } else {
        console.log('  No missing keys!');
    }
    
    // console.log(`  Unused in dictionary (${unusedInDict.length}): ${unusedInDict.join(', ')}`);
    console.log('');
});

if (potentialHardcoded.length > 0) {
    console.log('--- POTENTIAL HARDCODED STRINGS IN TEMPLATES ---');
    // Group by file
    const grouped = {};
    potentialHardcoded.forEach(h => {
        if (!grouped[h.file]) grouped[h.file] = new Set();
        grouped[h.file].add(h.text);
    });
    Object.keys(grouped).forEach(f => {
        console.log(`${f}: ${[...grouped[f]].join(' | ')}`);
    });
}
