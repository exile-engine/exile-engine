# @exile-engine/pob

PoB interchange contracts for Exile Engine. **XML and share-code import are not implemented.**

The runtime export `pobCompatibility` reports `status: 'contracts-only'`, `xmlImportImplemented: false`, and `shareCodeImportImplemented: false`. Types describe future XML sources, source locations, imported skills, unresolved input and an adapter contract. There is no placeholder importer returning an empty successful build.

A future adapter will map actual entity IDs directly where available and reconcile displayed item text against the target game's exact data snapshot. It must preserve unknown/ambiguous lines and import inputs rather than trusting saved output calculations. XML must remain data, with external entities and remote access disabled and explicit parsing/decompression limits.

No PoB executable, DLL, Lua interpreter, XML parser, URL fetcher or decompressor is bundled by this package.
