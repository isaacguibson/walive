import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../errors';
import type { McpTransportConfig, SaveMcpServerInput } from '@shared/ai/types';
import { normalizeBaseUrl } from '../providers/registry';

const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 1_000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;

function invalid(message: string): AppError {
  return new AppError('AI_INVALID_CONFIG', message);
}

/** Validates the configuration a user typed in; nothing is launched or contacted here. */
export function validateMcpServer(input: SaveMcpServerInput): { name: string; enabled: boolean; trusted: boolean } & McpTransportConfig {
  const name = input.name.trim();
  if (name === '' || name.length > 60) {
    throw invalid('Enter a server name of up to 60 characters.');
  }
  const common = { name, enabled: input.enabled === true, trusted: input.trusted === true };
  if (input.transport === 'http') {
    return { ...common, transport: 'http', url: normalizeBaseUrl(input.url) };
  }
  const command = input.command.trim();
  if (command === '' || command.length > 500 || CONTROL.test(command)) {
    throw invalid('Enter the executable to launch.');
  }
  if (input.args.length > MAX_ARGS || input.args.some((arg) => arg.length > MAX_ARG_LENGTH || CONTROL.test(arg))) {
    throw invalid('The arguments are invalid.');
  }
  return { ...common, transport: 'stdio', command, args: [...input.args] };
}

/** The command exactly as it will run, quoted so that it can be read back unambiguously. */
export function formatCommandLine(command: string, args: string[]): string {
  const quote = (part: string): string => (/^[\w./:=@%+-]+$/.test(part) ? part : JSON.stringify(part));
  return [command, ...args].map(quote).join(' ');
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) {
      return false;
    }
    await fs.access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds the program to launch: an absolute path, or a bare command name on the PATH. */
export async function resolveExecutable(command: string, searchPath = process.env['PATH'] ?? ''): Promise<string> {
  const hasSeparator = command.includes('/') || command.includes('\\');
  if (hasSeparator) {
    if (!path.isAbsolute(command)) {
      throw new AppError('AI_MCP_ERROR', 'Use an absolute path, or a command name that is on the PATH.');
    }
    if (await isExecutable(command)) {
      return command;
    }
    throw new AppError('AI_MCP_ERROR', 'The executable does not exist or cannot be run.');
  }
  const extensions = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD').split(';') : [''];
  for (const directory of searchPath.split(path.delimiter).filter((entry) => entry !== '')) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  throw new AppError('AI_MCP_ERROR', `The command "${command}" was not found on the PATH.`);
}
