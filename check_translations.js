const fs = require('fs');

// 1. Get all translation keys from the codebase
function getUsedKeys() {
    const files = ['index.html', 'js/app.js', 'js/parser.js', 'js/player.js', 'js/utils.js', 'js/auth.js'];
    const keys = new Set();
    // Improved regex to only match t('key') where t is exactly the translation function
    // We look for t('key') or {{ t('key') }} or :title="t('key')"
    const regex = /(?:[^a-zA-Z0-9])t\('([^']*)'\)/g;

    files.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            let match;
            while ((match = regex.exec(content)) !== null) {
                const key = match[1];
                // Filter out common false positives (CSS selectors, single chars, etc.)
                if (key.length > 2 && !key.startsWith('.') && !key.startsWith('#') && key !== 'div' && key !== 'script') {
                    // Filter out URL params that are NOT translations
                    const urlParams = ['view', 'forum', 'author', 'permlink', 'user', 'community', 'start_author', 'start_permlink'];
                    if (!urlParams.includes(key)) {
                        keys.add(key);
                    }
                }
            }
        }
    });
    return Array.from(keys).sort();
}

// 2. Load translations from js/translations.js
function getAvailableTranslations() {
    const content = fs.readFileSync('js/translations.js', 'utf8');
    const objectContent = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
    const TR = eval(`(${objectContent})`);
    return TR;
}

const usedKeys = getUsedKeys();
const availableTR = getAvailableTranslations();
const languages = Object.keys(availableTR);

console.log(`Checking ${usedKeys.length} keys across ${languages.join(', ')}...\n`);

let hasMissing = false;

languages.forEach(lang => {
    const missing = usedKeys.filter(key => !availableTR[lang][key]);
    if (missing.length > 0) {
        hasMissing = true;
        console.log(`[${lang.toUpperCase()}] Missing ${missing.length} keys:`);
        missing.forEach(key => console.log(`  - ${key}`));
        console.log('');
    } else {
        console.log(`[${lang.toUpperCase()}] All keys present!`);
    }
});

// Also check for keys in TR that are NOT used in code (cleanup)
console.log('--- Potential Unused keys (defined in translations.js but not found in code) ---');
languages.forEach(lang => {
    const keysInLang = Object.keys(availableTR[lang]);
    const unused = keysInLang.filter(key => !usedKeys.includes(key));
    if (unused.length > 0) {
        console.log(`[${lang.toUpperCase()}] ${unused.length} potential unused keys.`);
    }
});

if (hasMissing) {
    process.exit(1);
}
