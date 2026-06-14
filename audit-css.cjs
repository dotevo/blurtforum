const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const files = [];

function getFiles(dir) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) getFiles(res);
    else if (res.match(/\.(vue|css|ts|js)$/)) files.push(res);
  }
}
getFiles(srcDir);

// Regex to find class definitions in CSS blocks
// Matches .classname followed by whitespace or { or ,
const classDefRegex = /\.([a-zA-Z0-9_-]+)(?=[^}]*\{)/g;
const allDefinedClasses = new Map(); // className -> Set of files

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = classDefRegex.exec(content)) !== null) {
    const className = match[1];
    if (!className.match(/^[0-9]/) && className.length > 1) {
      if (!allDefinedClasses.has(className)) {
        allDefinedClasses.set(className, new Set());
      }
      allDefinedClasses.get(className).add(path.relative(__dirname, file));
    }
  }
});

console.log(`Auditing ${allDefinedClasses.size} unique CSS classes across ${files.length} files...\n`);

const orphans = [];
const allContent = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

for (const [className, defFiles] of allDefinedClasses.entries()) {
  // Search for the class name as a string literal, class attribute, or dynamic binding
  // This is a broad search: we check if the string exists in a way that suggests usage
  const pattern = new RegExp(`['"\\s]${className}['"\\s]|['"]${className}$|^${className}['"]|class=["'][^"']*${className}[^"']*["']|:class=["'][^"']*${className}[^"']*["']`, 'g');
  
  // We need to count occurrences. If it only occurs in the files where it was defined, 
  // and only as a definition, it might be an orphan.
  // To be safe, we just check total occurrences of the string in the whole codebase.
  const occurrences = (allContent.match(new RegExp(`\\b${className}\\b`, 'g')) || []).length;
  
  // If count <= total number of definitions, it's likely an orphan.
  // (A class can be defined in multiple files, e.g. different components).
  if (occurrences <= defFiles.size) {
    orphans.push({ name: className, files: Array.from(defFiles) });
  }
}

console.log('--- POTENTIAL UNUSED CSS CLASSES ---');
orphans.sort((a, b) => a.name.localeCompare(b.name)).forEach(o => {
  console.log(`[ ] .${o.name.padEnd(30)} (Defined in: ${o.files.join(', ')})`);
});

if (orphans.length === 0) console.log('No unused classes found.');
else console.log(`\nFound ${orphans.length} potential orphans.`);
