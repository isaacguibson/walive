const path = require('node:path');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const root = path.resolve(process.argv[2] ?? path.join(__dirname, '..'));
const { CopilotClient } = require(path.join(root, 'node_modules/@github/copilot-sdk'));

async function run() {
  const directory = await mkdtemp(path.join(tmpdir(), 'animation-studio-copilot-'));
  const client = new CopilotClient({
    mode: 'empty', useLoggedInUser: false, logLevel: 'none',
    workingDirectory: directory, baseDirectory: directory,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }
  });
  try {
    await client.start();
    console.log('Copilot runtime started without authentication:', await client.getStatus());
  } finally {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  }
}
run().catch(() => { console.error('Copilot runtime smoke check failed. Check platform artifacts and executable permissions.'); process.exitCode = 1; });