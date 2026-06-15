import { getMeta, setMeta } from './db.js';

// Endereço KERYX: prefixo "keryx:" + corpo bech32. Validação de formato apenas — a
// validação "de verdade" é feita consultando o saldo na API ao definir o endereço.
const ADDRESS_RE = /^keryx:[a-z0-9]{20,120}$/;

export function normalizeAddress(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidAddressFormat(addr: string): boolean {
  return ADDRESS_RE.test(normalizeAddress(addr));
}

/** Endereço monitorado no momento (definido pela UI). null se ainda não configurado. */
export function getActiveAddress(): string | null {
  return getMeta('active_address') ?? null;
}

export function setActiveAddress(addr: string): void {
  setMeta('active_address', normalizeAddress(addr));
}
