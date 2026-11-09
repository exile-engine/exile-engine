# Third-party attribution and data provenance

## Project code and game data

Exile Engine code is MIT licensed. Extracted game data and localized strings remain Grinding Gear Games material; the code license does not relicense that material or grant additional rights to it. Snapshot manifests record exact installed-build, schema, profile and source hashes. Asset paths in text records are references, not bundled artwork/audio.

## Path of Building Community

The reviewed stat mappings, reference arithmetic, passive-graph reader structure and item-template semantics are informed by the following MIT-licensed sources. No PoB executable, DLL, Lua runtime or updater is included or executed.

- PoE1 reference commit: `3dbca4463c0a59079d9f7f032d8240cf868e09da` in [PathOfBuildingCommunity/PathOfBuilding](https://github.com/PathOfBuildingCommunity/PathOfBuilding/tree/3dbca4463c0a59079d9f7f032d8240cf868e09da).
- PoE2 reference commit: `bb52d6b368307457eb9c54bb13f1829993d390b1` in [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/tree/bb52d6b368307457eb9c54bb13f1829993d390b1).
- Client-resolved Spark values are the runtime source authority. Reference checks derived from published source are labeled source-derived; they are not executed-PoB parity results.

Copyright (c) 2016 David Gowor

## Community schema and external extraction tools

The pinned schema is from [poe-tool-dev/dat-schema](https://github.com/poe-tool-dev/dat-schema), MIT licensed. Its exact bytes and SHA-256 are retained in the extraction profile.

Copyright (c) 2021 Alexander Drozdov

The optional external toolchain uses [pathofexile-dat](https://github.com/SnosMe/poe-dat-viewer) 16.0.0 (MIT), pathofexile-dat-schema 8.0.0 (MIT), and [ooz-wasm](https://github.com/SnosMe/ooz-wasm) 2.0.0 (GPL-3.0-or-later). These packages are installed separately outside the checkout. They are not vendored, redistributed in the engine packages, or members of its runtime dependency graph. Their respective licenses continue to apply to the external tools.

## MIT notice for the attributed sources

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
