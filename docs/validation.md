# Initial validation record

The initial implementation was checked with Node 24.6.0 and npm 11.5.1. The test runner uses the emitted ESM packages, not a TypeScript transpiler. Fifty tests cover core/rules, portable snapshot readers, English/Thai interpretation, actual client-data integration and source-only policy failures.

## Committed data

| Snapshot                        | PoE1        | PoE2        |
| ------------------------------- | ----------- | ----------- |
| Installed build                 | 26474023    | 26476662    |
| Build tables                    | 54          | 64          |
| Source table rows               | 309,910     | 201,013     |
| SD files                        | 45          | 589         |
| Locale-specific SD rules        | 194,277     | 215,339     |
| SD locales                      | 11          | 12          |
| Localized base/class label sets | 9           | 9           |
| Item templates                  | 413         | 277         |
| Passive graphs                  | 7           | 5           |
| Snapshot JSON bytes             | 442,888,299 | 344,507,831 |

Both complete extractions were repeated with the same pinned inputs and produced identical manifest identities:

- PoE1: `cfbf5330f9d85f67070aa163bfd7b1e5d1eb6dc4a045bccfd408708963b052c2`
- PoE2: `d50249f72650fc77e1238e9399f45d2c22412a477e62abf122214d619aa21d28`

The producer and validator preserve source exceptions rather than making the data appear cleaner than the client. PoE1 retains 15 dangling test/zero-base references and one unsupported original SD range. PoE2 retains repeated Atlas node 26306 occurrences in distinct groups and repeated Portuguese description sections. Unresolved references and unsupported inverse mappings do not become invented successful values.

## Runtime and distribution checks

- Source-derived Spark reference cases at levels 1, 20 and 40 match actual client-resolved rows; an independent PoE1 coefficient check covers all 40 levels. PoB was not executed.
- The constructed copied-wand example uses actual base labels and description templates, preserves full scoped candidate catalogs, and reconciles to the same canonical IDs and values in English and Thai for both games.
- A real desktop browser imported all seven emitted ESM packages and ran both snapshot/item/calculation flows successfully. The same example also runs in Node.
- Actual npm archives are checked for text-only contents and installed in an isolated temporary consumer. Runtime imports and TypeScript declarations are checked there. Archives are created outside the repository and removed after checking; nothing is published.
- GitHub Actions runs the aggregate verification and executable example on Linux and Windows with Node 24. Check the [workflow runs](https://github.com/exile-engine/exile-engine/actions/workflows/ci.yml) for the specific commit's hosted result.

This establishes the documented single-hit Spark and item-text slice. It does not establish full-build calculations, support for every data record, unimplemented PoB import, or universal testing across every JavaScript runtime and locale.
