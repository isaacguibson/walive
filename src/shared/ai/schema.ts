import type { JsonSchema } from './types';

const MAX_ISSUES = 5;

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeOf(value) === type;
  }
}

/** A malformed pattern from an external schema is ignored instead of rejecting the input. */
function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

function asSchema(value: unknown): JsonSchema | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonSchema) : null;
}

/**
 * Validates `value` against the subset of JSON Schema used by tool definitions: types, enums,
 * required and unknown properties, array items and numeric or length bounds. Keywords it does not
 * know are ignored, so schemas from external servers never reject valid input by accident.
 * Returns human-readable issues; an empty list means the value is valid.
 */
export function validateSchema(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const issues: string[] = [];
  check(schema, value, path, issues);
  return issues.slice(0, MAX_ISSUES);
}

function check(schema: JsonSchema, value: unknown, path: string, issues: string[]): void {
  if (issues.length >= MAX_ISSUES) {
    return;
  }
  const declared = schema['type'];
  const types = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.filter((t) => typeof t === 'string') : [];
  if (types.length > 0 && !types.some((type) => matchesType(type, value))) {
    issues.push(`${path} must be ${types.join(' or ')}`);
    return;
  }
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.includes(value)) {
    issues.push(`${path} must be one of: ${allowed.map(String).join(', ')}`);
    return;
  }
  if (typeof value === 'string') {
    checkBounds(schema, value.length, 'minLength', 'maxLength', `${path} length`, issues);
    if (typeof schema['pattern'] === 'string' && !matchesPattern(schema['pattern'], value)) {
      issues.push(`${path} has an invalid format`);
    }
  } else if (typeof value === 'number') {
    const { minimum, maximum } = schema;
    if (typeof minimum === 'number' && value < minimum) {
      issues.push(`${path} must be at least ${minimum}`);
    }
    if (typeof maximum === 'number' && value > maximum) {
      issues.push(`${path} must be at most ${maximum}`);
    }
  } else if (Array.isArray(value)) {
    checkBounds(schema, value.length, 'minItems', 'maxItems', `${path} item count`, issues);
    const items = asSchema(schema['items']);
    if (items !== null) {
      value.forEach((item, index) => check(items, item, `${path}[${index}]`, issues));
    }
  } else if (typeof value === 'object' && value !== null) {
    checkObject(schema, value as Record<string, unknown>, path, issues);
  }
}

function checkBounds(schema: JsonSchema, size: number, minKey: string, maxKey: string, label: string, issues: string[]): void {
  const min = schema[minKey];
  const max = schema[maxKey];
  if (typeof min === 'number' && size < min) {
    issues.push(`${label} must be at least ${min}`);
  }
  if (typeof max === 'number' && size > max) {
    issues.push(`${label} must be at most ${max}`);
  }
}

function checkObject(schema: JsonSchema, value: Record<string, unknown>, path: string, issues: string[]): void {
  const properties = asSchema(schema['properties']) ?? {};
  const required = Array.isArray(schema['required']) ? schema['required'] : [];
  for (const key of required) {
    if (typeof key === 'string' && value[key] === undefined) {
      issues.push(`${path}.${key} is required`);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const property = asSchema(properties[key]);
    if (property !== null) {
      check(property, item, `${path}.${key}`, issues);
    } else if (schema['additionalProperties'] === false) {
      issues.push(`${path}.${key} is not allowed`);
    }
  }
}
