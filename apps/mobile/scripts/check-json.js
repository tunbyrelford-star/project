const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const ignoreDirs = new Set(["node_modules"]);
const jsonFiles = [];

function collectJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        collectJsonFiles(full);
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      jsonFiles.push(full);
    }
  }
}

collectJsonFiles(rootDir);

for (const file of jsonFiles) {
  const content = fs.readFileSync(file, "utf8");
  JSON.parse(content);
}

console.log(`All JSON files are valid (${jsonFiles.length}).`);
