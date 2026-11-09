# @exile-engine/item-text

Portable SD parsing, reverse matching, item-text reconciliation and localized rendering. English and Thai are the tested initial copied-wand slice; SD data for other locales is preserved without claiming complete parser coverage.

`parseStatDescriptions(text, options)` parses extracted SD text into ordered stat groups, locales, ranges and handlers. Unsupported syntax stays explicit data/diagnostics. `parseItemText(text, catalog, options)` retains source lines, base candidates, modifier candidates, selected groups and unresolved input. `matchStatLine` supports isolated modifier matching. `renderStatGroup` renders a selected canonical group in another locale.

Use the reconciliation API to resolve ambiguous candidates; never automatically choose the first. A group's stat IDs and values remain ordered together, including multi-stat lines. The parser preserves punctuation in canonical IDs and uses bounded numeric matching, not executable input expressions.

The host supplies the catalog, exact snapshot identity and locale. This package performs no I/O. Supported damage/cast-speed modifier IDs are exported as `sparkWandStatIds`. A complete text interpretation still does not establish a complete equipment or character model. See the executable root example and security documentation for limits.
