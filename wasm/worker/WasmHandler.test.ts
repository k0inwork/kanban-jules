import { describe, it, expect } from 'vitest';

/**
 * The unpack logic from WasmHandler and WasmExecutorHandler:
 *
 *   const unpack = (arg: any) =>
 *     arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
 *   const obj = unpack(args[0]);
 *   const code = obj ? obj.code : args[0];
 *
 * We extract it here for direct testing.
 */
function unpackArg(args: any[]): { code: string } {
  const unpack = (arg: any) =>
    arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
  const obj = unpack(args[0]);
  return { code: obj ? obj.code : args[0] };
}

describe('WasmHandler arg unpacking', () => {
  it('should extract code from object arg with code field', () => {
    const result = unpackArg([{ code: 'ls -la' }]);
    expect(result.code).toBe('ls -la');
  });

  it('should use first arg directly when it is a string', () => {
    const result = unpackArg(['echo hello']);
    expect(result.code).toBe('echo hello');
  });

  it('should return undefined code when arg is an object without code field', () => {
    const result = unpackArg([{ command: 'ls' }]);
    expect(result.code).toBeUndefined();
  });

  it('should return null for null arg', () => {
    const result = unpackArg([null]);
    expect(result.code).toBeNull();
  });

  it('should fall through to raw arg for array arg (unpack returns null)', () => {
    const result = unpackArg([['nested']]);
    // unpack rejects arrays, so code falls through to args[0] = ['nested']
    expect(result.code).toEqual(['nested']);
  });

  it('should return undefined for undefined arg', () => {
    const result = unpackArg([undefined]);
    expect(result.code).toBeUndefined();
  });

  it('should return number directly for number arg', () => {
    const result = unpackArg([42]);
    expect(result.code).toBe(42);
  });

  it('should handle object with both code and extra fields', () => {
    const result = unpackArg([{ code: 'make build', timeout: 30 }]);
    expect(result.code).toBe('make build');
  });
});
