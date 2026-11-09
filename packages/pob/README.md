# @exile-engine/pob

Bounded, portable PoE1 normal Spark XML adaptation. This is a deliberately small synthetic fixture profile, not a complete character importer.

`importPobXml({ format: 'pob-xml', xml, target, buildId, configurationId })` returns `complete`, diagnostics, retained unresolved fields, original bounded XML, individual contributions and, only when adaptation is complete, `selectedSkill`. Pass that canonical input to `calculateSelectedSkill` in `@exile-engine/poe1`. Adaptation does not prove later calculation will succeed (for example, invalid aggregate cast speed still fails calculation). `target` is the exact host-reviewed PoE1 game/build/snapshot binding; PoB XML does not establish a client snapshot by itself. Build and configuration IDs are explicit host identities and remain attached to the selected input.

The accepted profile has explicit `Build targetVersion="3_0"`, one level 1 Witch with no ascendancy or allocated passives; one enabled normal Spark identified by both `Spark` and `Metadata/Items/Gems/SkillGemSpark`; `mainSocketGroup="1"`, `mainActiveSkill="1"`, and explicit legacy `Skill skillPart="1"` selecting **1 Hit**. Missing targetVersion is rejected: the pinned PoB reference otherwise interprets the file as legacy 2_6 and prompts conversion. Levels 1–40 and ordinary quality 0–100 are accepted. `Build/PlayerStat` saved outputs are ignored; they never supply calculation inputs. Optional plain Notes are data only. An omitted Items section means no equipment; an included Items section uses active set 1 and at most one equipped Body Armour item.

Enemy configuration must explicitly supply `enemyIsBoss` string `None`, `enemyLightningResist` number between -200 and 90, and `customMods` string **exactly** `Never deal Critical Strikes`. This sole accepted custom literal declares the noncritical comparison mode; arbitrary custom modifiers are rejected. No other resistance effects are accepted, so configured resistance equals effective resistance. Values above 90 are rejected rather than silently reproducing PoB's cap. Missing configuration fails visibly.

Item text is restricted to `Rarity: RARE`, `Synthetic Spark Fixture`, `Simple Robe`, `Implicits: 0`, then explicit English modifier lines matching the following table. No affix legality or complete equipment validation is claimed. This narrow grammar is an explicit mapping, not an arbitrary display-label replacement for stat identity. Increased/reduced values map to positive/negative percentage points. Repeated occurrences retain their order, raw line label, item ID and one-based line within the original decoded Item text, including leading empty lines.

| Exact line suffix                   | Game stat ID           |
| ----------------------------------- | ---------------------- |
| increased/reduced Damage            | `damage_+%`            |
| increased/reduced Spell Damage      | `spell_damage_+%`      |
| increased/reduced Lightning Damage  | `lightning_damage_+%`  |
| increased/reduced Projectile Damage | `projectile_damage_+%` |
| increased/reduced Cast Speed        | `base_cast_speed_+%`   |

Each line begins with a nonnegative decimal number followed by `% `. Unknown elements/attributes, multiple selections/sets, supports, other bases/implicits, local/conditional modifiers, conversions, added damage, allocated passives and other custom configuration remain unresolved and prevent a complete import. No successful empty-build placeholder is emitted.

The internal XML data reader has hard ceilings: 262,144 UTF-8 bytes, depth 16, 1,024 elements, 32 attributes per element and 131,072 decoded text/attribute characters. Items additionally allow 64 lines of 2,048 characters. Hosts may lower ceilings through the second argument, never raise them. DTDs, external entities, processing instructions, unknown entities, malformed XML and invalid characters are rejected. Predefined/numeric entities, comments and CDATA are handled as bounded text. No DOM, network, URL fetching, share-code decoding, decompression, Lua, executable or native dependency is used.

See `tests/fixtures/pob/` and the [executed pinned PoB comparison](../../docs/pob-reference.md) for the explicit fixture assumptions, external oracle evidence and limits.
