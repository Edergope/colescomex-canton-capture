export function privateDir(): string;
export function privateCases(): PrivateCase[] | null;
export const PRIVATE_SKIP_MSG: string;
export interface PrivateCase {
  id: string; external_ref: string;
  sides: Record<'front' | 'back', { file: string; sha256: string; corners: { x: number; y: number }[]; rot: number }>;
  expected: { fields: Record<string, string>; extras: Record<string, string[]>; products: string[]; printed_text: Record<'front' | 'back', string[]> };
}
