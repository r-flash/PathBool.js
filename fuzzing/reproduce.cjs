const fs = require("node:fs");

const crashFiles = fs.globSync("crash-*");

if (crashFiles.length === 0) {
    console.log("No crash file found.");
} else if (crashFiles.length > 1) {
    console.log("Multiple crash files found.");
} else {
    const buf = fs.readFileSync(crashFiles[0]);
    require("./target.cjs").fuzz(buf);
}
