import { packager } from '@electron/packager';
import { createRequire } from 'node:module';

const arch = process.env.ARCH ?? process.arch;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
  throw new Error('macOS packaging requires macOS and an arm64 or x64 target.');
}
const require = createRequire(import.meta.url);
require.resolve(`@github/copilot-sdk-darwin-${arch}/package.json`);
const identity = process.env.APPLE_SIGNING_IDENTITY;
const paths = await packager({
  dir: '.', name: 'Animation Studio', platform: 'darwin', arch,
  out: 'dist', overwrite: true, prune: true, asar: false,
  ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/specs($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/\.git($|\/)/],
  ...(identity ? { osxSign: { identity, hardenedRuntime: true } } : {})
});
console.log(paths.join('\n'));
if (!identity) console.log('Unsigned development package. Configure signing and notarization before distributing it.');