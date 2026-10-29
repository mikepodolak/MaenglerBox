import type { ModuleDef, ParamDef } from './types';

/** Map a param value to a 0..1 control position (respects exponential curves). */
export function toNormalized(p: ParamDef, value: number): number {
  if (p.curve === 'exp' && p.min > 0) {
    return Math.log(value / p.min) / Math.log(p.max / p.min);
  }
  return (value - p.min) / (p.max - p.min);
}

/** Map a 0..1 control position back to a param value, snapped to its step. */
export function fromNormalized(p: ParamDef, n: number): number {
  const t = Math.min(1, Math.max(0, n));
  let v = p.curve === 'exp' && p.min > 0 ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min);
  if (p.step) v = Math.round(v / p.step) * p.step;
  return Math.min(p.max, Math.max(p.min, v));
}

export function formatParam(p: ParamDef, value: number): string {
  if (p.options) return p.options[Math.round(value - p.min)] ?? String(value);
  const digits = p.step && p.step >= 1 ? 0 : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 3;
  return `${value.toFixed(digits)}${p.unit ? ` ${p.unit}` : ''}`;
}

/**
 * A param's label, with its group in front when the label alone is ambiguous
 * (the FM Voice has a Ratio per operator): 'Operator 2 Ratio'.
 */
export function fullParamLabel(def: ModuleDef, id: string): string {
  const p = def.params.find((x) => x.id === id);
  if (!p) return id;
  if (def.params.filter((x) => x.label === p.label).length < 2) return p.label;
  const g = def.groups?.find((x) => x.params.includes(id));
  return g ? `${g.label.replace(/\s*\(.*\)$/, '')} ${p.label}` : p.label;
}
