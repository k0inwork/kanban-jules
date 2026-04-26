import { describe, it, expect } from 'vitest';
import { PAW_PROGRAMS, getActiveVariant, buildPawPrompt } from '../paw-programs';

describe('paw-programs', () => {
  describe('PAW_PROGRAMS', () => {
    it('should have signal-noise program', () => {
      expect(PAW_PROGRAMS['signal-noise']).toBeDefined();
      expect(PAW_PROGRAMS['signal-noise'].id).toBe('signal-noise');
    });

    it('should have at least one variant per program', () => {
      for (const program of Object.values(PAW_PROGRAMS)) {
        expect(program.variants.length).toBeGreaterThan(0);
      }
    });

    it('should have activeVariantId pointing to existing variant', () => {
      for (const program of Object.values(PAW_PROGRAMS)) {
        const variantIds = program.variants.map(v => v.id);
        expect(variantIds).toContain(program.activeVariantId);
      }
    });

    it('should have examples for each variant', () => {
      for (const program of Object.values(PAW_PROGRAMS)) {
        for (const variant of program.variants) {
          expect(variant.examples.length).toBeGreaterThan(0);
          for (const ex of variant.examples) {
            expect(ex.input).toBeDefined();
            expect(ex.output).toBeDefined();
          }
        }
      }
    });
  });

  describe('getActiveVariant()', () => {
    it('should return the active variant', () => {
      const program = PAW_PROGRAMS['signal-noise'];
      const variant = getActiveVariant(program);
      expect(variant.id).toBe(program.activeVariantId);
    });

    it('should throw for invalid activeVariantId', () => {
      const program = { ...PAW_PROGRAMS['signal-noise'], activeVariantId: 'nonexistent' };
      expect(() => getActiveVariant(program)).toThrow();
    });
  });

  describe('buildPawPrompt()', () => {
    it('should construct prompt with variant text and input', () => {
      const program = PAW_PROGRAMS['signal-noise'];
      const prompt = buildPawPrompt(program, 'Running tests now...');
      expect(prompt).toContain('Running tests now...');
      expect(prompt).toContain('Input:');
      expect(prompt).toContain('Output:');
    });

    it('should include the active variant prompt text', () => {
      const program = PAW_PROGRAMS['signal-noise'];
      const variant = getActiveVariant(program);
      const prompt = buildPawPrompt(program, 'test input');
      expect(prompt).toContain(variant.prompt.substring(0, 50));
    });
  });
});
