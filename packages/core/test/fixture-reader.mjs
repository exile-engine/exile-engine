/** Convert the small recorded raw-client subset into the public catalog contract. */
export function fixtureReader(fixture) {
  const tables = new Map();
  for (const [name, rawRows] of Object.entries(fixture.tables)) {
    tables.set(
      name,
      rawRows.map((raw) => ({
        key: typeof raw.Id === 'string' && raw.Id ? raw.Id : `${name}:${raw._index}`,
        rowIndex: raw._index,
        fields: { ...raw },
      })),
    );
  }
  function reference(table, index) {
    const row = tables.get(table)?.find((candidate) => candidate.rowIndex === index);
    if (!row) throw new Error(`Fixture is missing ${table} row ${index}`);
    return { kind: 'ref', table, key: row.key, rowIndex: index };
  }
  for (const [table, rows] of tables) {
    for (const record of rows) {
      const fields = record.fields;
      if (table === 'GrantedEffects') {
        for (const field of ['StatSet', 'StatSet1']) {
          if (fields[field] !== undefined)
            fields[field] = reference('GrantedEffectStatSets', fields[field]);
        }
      } else if (table === 'GrantedEffectsPerLevel') {
        fields.GrantedEffect = reference('GrantedEffects', fields.GrantedEffect);
      } else if (table === 'GrantedEffectStatSetsPerLevel') {
        fields.StatSet = reference('GrantedEffectStatSets', fields.StatSet);
        fields.FloatStats = fields.FloatStats.map((index) => reference('Stats', index));
        fields.AdditionalStats = fields.AdditionalStats.map((index) => reference('Stats', index));
      } else if (table === 'GrantedEffectStatSets') {
        fields.ImplicitStats = fields.ImplicitStats.map((index) => reference('Stats', index));
        fields.ConstantStats = fields.ConstantStats.map((index) => reference('Stats', index));
      } else if (table === 'GrantedEffectQualityStats') {
        for (const field of ['GrantedEffect', 'GrantedEffectsKey']) {
          if (fields[field] !== undefined)
            fields[field] = reference('GrantedEffects', fields[field]);
        }
        for (const field of ['Stats', 'StatsKeys']) {
          if (fields[field] !== undefined)
            fields[field] = fields[field].map((index) => reference('Stats', index));
        }
      }
    }
  }
  return {
    identity: { ...fixture.identity },
    async getTable(table) {
      if (!tables.has(table)) throw new Error(`Missing fixture table ${table}`);
      return tables.get(table);
    },
    async getRecord(table, key) {
      return tables.get(table)?.find((record) => record.key === key);
    },
    async resolve(ref) {
      return tables
        .get(ref.table)
        ?.find((record) => record.key === ref.key && record.rowIndex === ref.rowIndex);
    },
  };
}
