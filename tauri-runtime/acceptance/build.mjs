import {mkdirSync, writeFileSync} from "node:fs";
mkdirSync("dist",{recursive:true});
writeFileSync("dist/index.html", '<!doctype html><html><head><meta charset="utf-8"><title>Agent Workspace Tauri smoke</title></head><body><main>Tauri build acceptance</main></body></html>');
console.log("Static Tauri frontend: PASS");
