import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const versionIndex = args.indexOf('--version');
const version = versionIndex >= 0 ? args[versionIndex + 1] : process.env.PLUGIN_VERSION;
const mcpUrl = process.env.AGENT_WORKSPACE_MCP_URL || 'https://agent-workspace.apphome.one/mcp';
const outputRoot = resolve(process.env.PLUGIN_OUTPUT_DIR || 'build/plugin');
const outputDir = resolve(outputRoot, 'agent-workspace');

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`PLUGIN_VERSION must be a strict semantic version, got: ${version ?? '<missing>'}`);
}

const parsedMcpUrl = new URL(mcpUrl);
if (parsedMcpUrl.protocol !== 'https:') {
  throw new Error('AGENT_WORKSPACE_MCP_URL must use HTTPS');
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const pluginTemplate = await readFile('plugin/plugin.template.json', 'utf8');
const mcpTemplate = await readFile('plugin/mcp.template.json', 'utf8');

const pluginJson = pluginTemplate.replaceAll('__PLUGIN_VERSION__', version);
const mcpJson = mcpTemplate.replaceAll('__AGENT_WORKSPACE_MCP_URL__', mcpUrl);

JSON.parse(pluginJson);
JSON.parse(mcpJson);

await writeFile(resolve(outputDir, 'plugin.json'), pluginJson);
await writeFile(resolve(outputDir, 'mcp.json'), mcpJson);
await cp('plugin/skills', resolve(outputDir, 'skills'), { recursive: true });

const manifest = JSON.parse(pluginJson);
const mcp = JSON.parse(mcpJson);
if (manifest.name !== 'agent-workspace' || manifest.version !== version) {
  throw new Error('Generated plugin manifest identity/version validation failed');
}
if (manifest.extensions?.['com.openai']?.interface?.shortDescription?.length > 30) {
  throw new Error('OpenAI shortDescription must be at most 30 characters');
}
if (mcp.mcpServers?.['agent-workspace']?.url !== mcpUrl) {
  throw new Error('Generated MCP URL validation failed');
}

console.log(`Generated plugin package directory: ${outputDir}`);
console.log(`Plugin version: ${version}`);
console.log(`MCP endpoint: ${mcpUrl}`);
