import type {
  CatalogReader,
  CatalogRecord,
  CatalogRef,
  SnapshotIdentity,
} from '@exile-engine/core';
import type { SdRule } from '@exile-engine/core';

export interface ShardDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly records: number;
  readonly scopes?: readonly string[];
  readonly locales?: readonly string[];
}
export interface SnapshotManifest {
  readonly format: 'exile-engine-snapshot-v1';
  readonly identity: SnapshotIdentity;
  readonly tables: Readonly<
    Record<string, { readonly rows: number; readonly shards: readonly ShardDescriptor[] }>
  >;
  readonly descriptions: {
    readonly rules: number;
    readonly files: number;
    readonly shards: readonly ShardDescriptor[];
    readonly fileShards: readonly ShardDescriptor[];
    readonly locales: readonly string[];
  };
  readonly passiveGraphs: { readonly records: number; readonly shards: readonly ShardDescriptor[] };
  readonly templates: { readonly records: number; readonly shards: readonly ShardDescriptor[] };
  readonly localizations?: Readonly<
    Record<
      string,
      Readonly<
        Record<string, { readonly rows: number; readonly shards: readonly ShardDescriptor[] }>
      >
    >
  >;
}
export type ReadShard = (path: string) => Promise<Uint8Array | string>;
export type DescriptionRule = SdRule;
export interface DescriptionFile {
  readonly sourcePath: string;
  readonly includes: readonly string[];
  readonly noDescriptionStatIds: readonly string[];
  readonly rules: number;
  readonly directives: readonly unknown[];
  readonly unparsedLines: readonly unknown[];
  readonly diagnostics: readonly unknown[];
}
export interface SnapshotCatalogReader extends CatalogReader {
  readonly manifest: SnapshotManifest;
  getDescriptions(scope?: string, locale?: string): Promise<readonly DescriptionRule[]>;
  getDescriptionFiles(): Promise<readonly DescriptionFile[]>;
  getLocalizedTable(name: string, locale: string): Promise<readonly CatalogRecord[]>;
  getPassiveGraphs(): Promise<readonly unknown[]>;
  getTemplates(): Promise<readonly unknown[]>;
  clearCache(): void;
}
interface PortableGlobals {
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new (
    encoding?: string,
    options?: { fatal?: boolean },
  ) => { decode(bytes: Uint8Array): string };
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
}
export interface CatalogHost {
  encodeUtf8(text: string): Uint8Array;
  decodeUtf8(bytes: Uint8Array): string;
  sha256(bytes: Uint8Array): Promise<string>;
}
export interface CatalogOptions {
  readonly host?: CatalogHost;
}
function defaultHost(): CatalogHost {
  const globals = globalThis as unknown as PortableGlobals;
  if (
    typeof globals.TextEncoder !== 'function' ||
    typeof globals.TextDecoder !== 'function' ||
    typeof globals.crypto?.subtle?.digest !== 'function'
  )
    throw new Error(
      'This runtime needs UTF-8 encoding/decoding and WebCrypto SHA-256, or an injected CatalogHost.',
    );
  return {
    encodeUtf8: (value) => new globals.TextEncoder().encode(value),
    decodeUtf8: (value) => new globals.TextDecoder('utf-8', { fatal: true }).decode(value),
    async sha256(value) {
      const digest = new Uint8Array(await globals.crypto.subtle.digest('SHA-256', value));
      return Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('');
    },
  };
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function validatePath(value: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Unsafe shard path.');
}
async function readJson(
  read: ReadShard,
  descriptor: ShardDescriptor,
  host: CatalogHost,
): Promise<unknown[]> {
  validatePath(descriptor.path);
  if (
    !Number.isSafeInteger(descriptor.bytes) ||
    descriptor.bytes < 3 ||
    descriptor.bytes > 4194304 ||
    !Number.isSafeInteger(descriptor.records) ||
    descriptor.records < 0 ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256)
  )
    throw new Error('Invalid shard descriptor: ' + descriptor.path);
  const raw = await read(descriptor.path);
  const bytes = typeof raw === 'string' ? host.encodeUtf8(raw) : raw;
  if (bytes.byteLength !== descriptor.bytes || bytes.byteLength > 4194304)
    throw new Error('Shard size mismatch: ' + descriptor.path);
  const actual = await host.sha256(bytes);
  if (actual !== descriptor.sha256) throw new Error('Shard hash mismatch: ' + descriptor.path);
  const parsed: unknown = JSON.parse(host.decodeUtf8(bytes));
  if (!Array.isArray(parsed) || parsed.length !== descriptor.records)
    throw new Error('Shard record count mismatch: ' + descriptor.path);
  return parsed as unknown[];
}
export function createCatalogReader(
  manifest: SnapshotManifest,
  readShard: ReadShard,
  options: CatalogOptions = {},
): SnapshotCatalogReader {
  if (
    !isObject(manifest) ||
    manifest.format !== 'exile-engine-snapshot-v1' ||
    !isObject(manifest.identity) ||
    manifest.identity.game !== 'poe2' ||
    !/^[a-f0-9]{64}$/.test(manifest.identity.snapshotId) ||
    !isObject(manifest.tables)
  )
    throw new Error('Invalid PoE2 snapshot manifest.');
  const cache = new Map<string, Promise<readonly CatalogRecord[]>>();
  const host = options.host || defaultHost();
  const verifyManifest = async (): Promise<void> => {
    const copy = JSON.parse(JSON.stringify(manifest)) as { identity: { snapshotId?: string } };
    delete copy.identity.snapshotId;
    if ((await host.sha256(host.encodeUtf8(JSON.stringify(copy)))) !== manifest.identity.snapshotId)
      throw new Error('Snapshot manifest identity mismatch.');
  };
  let manifestReady: Promise<void> | undefined;
  const ready = (): Promise<void> => (manifestReady ??= verifyManifest());
  const recordIndexes = new Map<string, ReadonlyMap<string, CatalogRecord>>();
  const load = async (shards: readonly ShardDescriptor[]): Promise<readonly unknown[]> => {
    await ready();
    const records: unknown[] = [];
    for (const shard of shards) records.push(...(await readJson(readShard, shard, host)));
    return records;
  };
  const reader: SnapshotCatalogReader = {
    identity: manifest.identity,
    manifest,
    getTable(name) {
      const present = cache.get(name);
      if (present) return present;
      const table = manifest.tables[name];
      if (!table) return Promise.reject(new Error('Table absent from snapshot: ' + name));
      const pending = load(table.shards)
        .then((rows) => {
          if (rows.length !== table.rows) throw new Error('Table row count mismatch: ' + name);
          const records: CatalogRecord[] = [];
          const index = new Map<string, CatalogRecord>();
          for (const [i, value] of rows.entries()) {
            if (
              !isObject(value) ||
              typeof value.key !== 'string' ||
              value.rowIndex !== i ||
              !isObject(value.fields) ||
              index.has(value.key)
            )
              throw new Error('Invalid catalog record: ' + name);
            const record = value as unknown as CatalogRecord;
            records.push(record);
            index.set(record.key, record);
          }
          recordIndexes.set(name, index);
          return records;
        })
        .catch((error: unknown) => {
          cache.delete(name);
          throw error;
        });
      cache.set(name, pending);
      return pending;
    },
    async getRecord(table, key) {
      await reader.getTable(table);
      return recordIndexes.get(table)?.get(key);
    },
    async resolve(ref: CatalogRef) {
      const record = await reader.getRecord(ref.table, ref.key);
      return record?.rowIndex === ref.rowIndex ? record : undefined;
    },
    async getDescriptions(scope, locale) {
      const normalized = (value: string): string =>
        value
          .replaceAll('\\', '/')
          .replace(/\.(?:txt|csd)$/i, '')
          .toLowerCase();
      let files: readonly DescriptionFile[] = [];
      let wanted = new Set<string>();
      let target: string | undefined;
      if (scope) {
        files = await reader.getDescriptionFiles();
        const query = normalized(scope);
        const matches = files.filter(
          (f) =>
            normalized(f.sourcePath) === query ||
            normalized(f.sourcePath).split('/').at(-1) === query,
        );
        if (matches.length !== 1)
          throw new Error('Missing or ambiguous description scope: ' + scope);
        target = normalized(matches[0]!.sourcePath);
        const visit = (name: string, stack: Set<string>): void => {
          if (stack.has(name)) throw new Error('Cyclic SD include: ' + name);
          if (wanted.has(name)) return;
          const file = files.find((f) => normalized(f.sourcePath) === name);
          if (!file) throw new Error('Missing SD include: ' + name);
          stack.add(name);
          for (const include of file.includes) visit(normalized(include), stack);
          stack.delete(name);
          wanted.add(name);
        };
        visit(target, new Set());
      }
      const shards = manifest.descriptions.shards.filter(
        (s) =>
          (!scope || !s.scopes || s.scopes.some((name) => wanted.has(normalized(name)))) &&
          (!locale || !s.locales || s.locales.includes(locale)),
      );
      const values = await load(shards);
      if (!scope && !locale && values.length !== manifest.descriptions.rules)
        throw new Error('Description count mismatch.');
      const rules: DescriptionRule[] = [];
      for (const r of values) {
        if (
          !isObject(r) ||
          typeof r.id !== 'string' ||
          typeof r.groupId !== 'string' ||
          typeof r.sourcePath !== 'string' ||
          typeof r.scope !== 'string' ||
          typeof r.locale !== 'string' ||
          !Array.isArray(r.statIds) ||
          !r.statIds.every((id) => typeof id === 'string') ||
          !Array.isArray(r.variants)
        )
          throw new Error('Invalid description record.');
        if ((!scope || wanted.has(normalized(r.scope))) && (!locale || r.locale === locale))
          rules.push(r as unknown as DescriptionRule);
      }
      if (!target) return rules;
      const signature = (r: DescriptionRule): string =>
        JSON.stringify([[...r.statIds].sort(), r.locale, r.hand ?? '']);
      const resolveScope = (name: string): DescriptionRule[] => {
        const file = files.find((f) => normalized(f.sourcePath) === name)!;
        const own = rules.filter((r) => normalized(r.scope) === name);
        const hidden = new Set(file.noDescriptionStatIds);
        const overrides = new Set(own.map(signature));
        const inherited = file.includes
          .flatMap((include) => resolveScope(normalized(include)))
          .filter((r) => !r.statIds.some((id) => hidden.has(id)) && !overrides.has(signature(r)));
        return [...own, ...inherited];
      };
      return resolveScope(target);
    },
    async getDescriptionFiles() {
      const values = await load(manifest.descriptions.fileShards);
      if (values.length !== manifest.descriptions.files)
        throw new Error('Description file count mismatch.');
      return values.map((value) => {
        if (
          !isObject(value) ||
          typeof value.sourcePath !== 'string' ||
          !Array.isArray(value.includes) ||
          !value.includes.every((v) => typeof v === 'string') ||
          !Array.isArray(value.noDescriptionStatIds) ||
          !value.noDescriptionStatIds.every((v) => typeof v === 'string')
        )
          throw new Error('Invalid SD file metadata.');
        return value as unknown as DescriptionFile;
      });
    },
    async getLocalizedTable(name, locale) {
      if (locale === 'en') return reader.getTable(name);
      const table = manifest.localizations?.[locale]?.[name];
      if (!table) throw new Error('Localized table absent: ' + locale + '/' + name);
      const values = await load(table.shards);
      if (values.length !== table.rows) throw new Error('Localized table row count mismatch.');
      const english = await reader.getTable(name);
      return values.map((r, i) => {
        if (!isObject(r) || r.key !== english[i]?.key || r.rowIndex !== i || !isObject(r.fields))
          throw new Error('Localized canonical ID mismatch.');
        return r as unknown as CatalogRecord;
      });
    },
    getPassiveGraphs() {
      return load(manifest.passiveGraphs.shards);
    },
    getTemplates() {
      return load(manifest.templates.shards);
    },
    clearCache() {
      cache.clear();
      recordIndexes.clear();
      manifestReady = undefined;
    },
  };
  return reader;
}
export async function loadCatalog(
  readShard: ReadShard,
  options: CatalogOptions = {},
): Promise<SnapshotCatalogReader> {
  const host = options.host || defaultHost();
  const raw = await readShard('manifest.json');
  const value: unknown = JSON.parse(typeof raw === 'string' ? raw : host.decodeUtf8(raw));
  if (!isObject(value)) throw new Error('Invalid manifest.');
  return createCatalogReader(value as unknown as SnapshotManifest, readShard, { host });
}
