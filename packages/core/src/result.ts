import type { Diagnostic, Result, SnapshotIdentity } from './types.js';

export function success<T>(value: T, diagnostics: readonly Diagnostic[] = []): Result<T> {
  return { ok: true, value, diagnostics };
}

export function failure<T = never>(...diagnostics: readonly Diagnostic[]): Result<T> {
  return { ok: false, diagnostics };
}

export function errorDiagnostic(code: string, message: string): Diagnostic {
  return { code, severity: 'error', message };
}

export function sameSnapshot(left: SnapshotIdentity, right: SnapshotIdentity): boolean {
  return (
    left.game === right.game && left.build === right.build && left.snapshotId === right.snapshotId
  );
}

export function isSnapshotIdentity(value: unknown): value is SnapshotIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.game === 'poe1' || candidate.game === 'poe2') &&
    typeof candidate.build === 'string' &&
    candidate.build.length > 0 &&
    typeof candidate.snapshotId === 'string' &&
    candidate.snapshotId.length > 0
  );
}
