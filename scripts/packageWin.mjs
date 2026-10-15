import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const arch = process.env.ARCH ?? 'x64';
if (!['x64', 'arm64'].includes(arch)) {
  throw new Error('ARCH must be x64 or arm64.');
}
if (!existsSync(join(root, 'out', 'main', 'main.js'))) {
  throw new Error('Run "npm run build" first.');
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

// The dependencies are installed in a clean directory for the Windows target, so that the runtime of the
// Copilot SDK and ffmpeg are the Windows binaries whatever the machine that builds the installer.
const stage = mkdtempSync(join(tmpdir(), 'walive-win-'));
try {
  for (const file of ['package.json', 'package-lock.json']) {
    cpSync(join(root, file), join(stage, file));
  }
  cpSync(join(root, 'out'), join(stage, 'out'), { recursive: true });

  // Scripts are skipped: they would build for this machine. The native packages for Windows are optional dependencies,
  // and the only download that matters (ffmpeg) is done below for the Windows target.
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--os=win32', `--cpu=${arch}`], { cwd: stage });
  run(process.execPath, ['install.js'], {
    cwd: join(stage, 'node_modules', 'ffmpeg-static'),
    env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: arch }
  });

  const required = [
    join('node_modules', '@github', `copilot-sdk-win32-${arch}`, 'prebuilds', `win32-${arch}`, 'copilot-runtime.exe'),
    join('node_modules', '@koromix', `koffi-win32-${arch}`, 'package.json'),
    join('node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  ];
  for (const file of required) {
    if (!existsSync(join(stage, file))) {
      throw new Error(`The Windows package is missing ${file}.`);
    }
  }

  const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  run(
    process.execPath,
    [
      join(root, 'node_modules', 'electron-builder', 'cli.js'),
      '--win',
      'nsis',
      `--${arch}`,
      '--publish',
      'never',
      `-c.electronVersion=${electronVersion}`,
      `-c.directories.output=${join(root, 'release')}`
    ],
    { cwd: stage }
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log(`Installer written to ${join(root, 'release')}. It is not code signed, so Windows SmartScreen will warn about it.`);
