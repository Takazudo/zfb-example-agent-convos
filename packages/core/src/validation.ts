import type { ErrorCode, Json, Principal, Result } from './domain.js';
export const LIMITS = Object.freeze({
    title: 120, inputBytes: 16384, skillBytes: 32768, outputBytes: 16384,
    contextBytes: 262144, eventBytes: 131072, pageBytes: 262144,
    listSize: 50, messagePageSize: 50, eventPageSize: 100,
    runsPerConversation: 128, messagesPerConversation: 256, bodyBytes: 65536,
});
export class DomainError extends Error {
    constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false) {
        super(message);
        this.name = 'DomainError';
    }
}
export class ConflictError extends Error {
    constructor() { super('Atomic precondition changed'); this.name = 'ConflictError'; }
}
export function invalid(message = 'The request has an invalid shape.'): never {
    throw new DomainError('INVALID_REQUEST', message);
}
export function bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        invalid();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        invalid();
    for (const key of Object.keys(value))
        if (!keys.includes(key))
            invalid(`Unknown field: ${key}`);
    return value as Record<string, unknown>;
}
export function text(value: unknown, maxBytes: number, minBytes = 1): string {
    if (typeof value !== 'string' || bytes(value) < minBytes || bytes(value) > maxBytes || value.includes('\u0000'))
        invalid('Text is empty or exceeds its byte limit.');
    // Reject lone UTF-16 surrogates: TextEncoder would otherwise hash replacement characters.
    for (let i = 0; i < value.length; i++) {
        const n = value.charCodeAt(i);
        if (n >= 0xd800 && n <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff))
                invalid('Text contains invalid Unicode.');
        }
        else if (n >= 0xdc00 && n <= 0xdfff)
            invalid('Text contains invalid Unicode.');
    }
    return value;
}
export function id(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
        invalid('Invalid identifier.');
    return value;
}
export function requestKey(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
        invalid('Invalid idempotency key.');
    return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        invalid('Invalid integer.');
    return value;
}
export function bool(value: unknown): boolean { if (typeof value !== 'boolean')
    invalid(); return value; }
export function hash(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
        invalid('Invalid SHA-256 digest.');
    return value;
}
export function title(value: unknown): string {
    const result = text(value, LIMITS.title * 4).trim();
    if (!result || [...result].length > LIMITS.title)
        invalid('Title must contain 1–120 characters.');
    return result;
}
/** Canonical JSON for this protocol: plain objects, sorted keys, finite numbers.
 * No normalization of user text or lossy undefined-to-null conversions. */
export function canonical(value: unknown, depth = 0): string {
    if (depth > 32)
        invalid('JSON nesting exceeds the limit.');
    if (value === null || typeof value === 'boolean')
        return String(value);
    if (typeof value === 'string')
        return JSON.stringify(text(value, LIMITS.contextBytes, 0));
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            invalid();
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(v => canonical(v, depth + 1)).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        const row = object(value, keys);
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(row[k], depth + 1)}`).join(',')}}`;
    }
    return invalid('Value is not JSON.');
}
export async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function digest(value: unknown): Promise<string> { return sha256(canonical(value)); }
export function clone<T>(value: T): T { return structuredClone(value); }
export function requireCapability(principal: Principal, capability: Principal['capabilities'][number]): void {
    for (const value of [principal.tenantId, principal.applicationId, principal.workspaceId, principal.actorId])
        id(value);
    if (!principal.capabilities.includes(capability))
        throw new DomainError('FORBIDDEN', 'This operation is not permitted.');
}
export function failed<T>(error: DomainError, requestId: string): Result<T> {
    return { ok: false, error: { code: error.code, message: error.message, retryable: error.retryable }, requestId };
}
export function asJson(value: unknown): Json { return JSON.parse(canonical(value)) as Json; }
export function throwIfAborted(signal?: AbortSignal): void { signal?.throwIfAborted(); }
