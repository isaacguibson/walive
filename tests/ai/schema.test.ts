import { describe, expect, it } from 'vitest';
import { validateSchema } from '@shared/ai/schema';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 5 },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    mode: { type: 'string', enum: ['a', 'b'] },
    color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
    points: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }
  },
  required: ['name'],
  additionalProperties: false
};

describe('schema validation', () => {
  it('accepts a valid value', () => {
    expect(validateSchema(schema, { name: 'ab', count: 3, mode: 'a', color: '#00ff00', points: [[1, 2]] })).toEqual([]);
  });

  it('reports missing required properties and unknown ones', () => {
    expect(validateSchema(schema, {})).toEqual(['input.name is required']);
    expect(validateSchema(schema, { name: 'ab', extra: 1 })).toEqual(['input.extra is not allowed']);
  });

  it('checks types, including integers and non-objects', () => {
    expect(validateSchema(schema, { name: 5 })).toEqual(['input.name must be string']);
    expect(validateSchema(schema, { name: 'ab', count: 1.5 })).toEqual(['input.count must be integer']);
    expect(validateSchema(schema, 'text')).toEqual(['input must be object']);
    expect(validateSchema(schema, null)).toEqual(['input must be object']);
    expect(validateSchema(schema, [])).toEqual(['input must be object']);
  });

  it('checks bounds, enums and patterns', () => {
    expect(validateSchema(schema, { name: 'a' })).toEqual(['input.name length must be at least 2']);
    expect(validateSchema(schema, { name: 'abcdef' })).toEqual(['input.name length must be at most 5']);
    expect(validateSchema(schema, { name: 'ab', count: 0 })).toEqual(['input.count must be at least 1']);
    expect(validateSchema(schema, { name: 'ab', count: 11 })).toEqual(['input.count must be at most 10']);
    expect(validateSchema(schema, { name: 'ab', mode: 'c' })).toEqual(['input.mode must be one of: a, b']);
    expect(validateSchema(schema, { name: 'ab', color: 'red' })).toEqual(['input.color has an invalid format']);
  });

  it('validates nested arrays with their path', () => {
    expect(validateSchema(schema, { name: 'ab', points: [[1, 'x']] })).toEqual(['input.points[0][1] must be number']);
    expect(validateSchema(schema, { name: 'ab', points: [] })).toEqual(['input.points item count must be at least 1']);
    expect(validateSchema(schema, { name: 'ab', points: [[1, 2], [1, 2], [1, 2]] })).toEqual(['input.points item count must be at most 2']);
  });

  it('ignores keywords it does not know and malformed patterns, so external schemas stay usable', () => {
    expect(validateSchema({ type: 'object', properties: { a: { type: 'string', format: 'uri', pattern: '(' } }, oneOf: [] }, { a: 'x' })).toEqual([]);
  });

  it('limits how many issues it reports', () => {
    const many = { type: 'object', required: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    expect(validateSchema(many, {}).length).toBeLessThanOrEqual(5);
  });
});
