// Crea las colecciones LANDING (ángulos de campañas de Meta) para la PLP de NUMEN.
// Para cada una decide SMART vs MANUAL en runtime:
//   - SMART  → si el metafield de la regla existe Y tiene la capability smartCollectionCondition
//              habilitada (si no, collectionCreate rebota). Si no, cae a MANUAL con aviso.
//   - MANUAL → siempre, para las de curaduría (equivalencias legales, "más elegidos", regalos, decants).
// Idempotente: dedupe por HANDLE (no recrea las que ya existen). Cada colección lleva un
// descriptionHtml placeholder de 1 línea (editable en Admin → Colecciones).
//
//   node create-landing-collections.mjs
//   node create-landing-collections.mjs --dry-run   # muestra qué crearía + clasificación, sin escribir
//
// ORDEN RECOMENDADO: corré antes `npm run setup` (habilita las capabilities de los facets) y
// `npm run load` (carga ocasion/estacion/longevidad), si no las smart caen a manual/fallback.

import { gql, loadDotEnv } from './lib/shopify.mjs';

await loadDotEnv();
const DRY = process.argv.includes('--dry-run');

// 1) Definiciones facet: id + si pueden armar smart collection (capability habilitada).
const defsData = await gql(`{
  metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") {
    nodes { key id capabilities { smartCollectionCondition { enabled } } }
  }
}`);
const defByKey = {};
for (const n of defsData.metafieldDefinitions.nodes) {
  defByKey[n.key] = { id: n.id, smart: n.capabilities.smartCollectionCondition.enabled };
}
// Estado de un metafield para armar smart collection: 'ok' | 'no existe' | 'capability off'.
function smartStatus(key) {
  if (!defByKey[key]) return 'no existe';
  if (!defByKey[key].smart) return 'capability off (corré setup)';
  return 'ok';
}

// 2) Handles existentes (idempotencia: no recrear).
const handles = new Set();
let cc = null;
do {
  const d = await gql(`query($c: String) {
    collections(first: 100, after: $c) { pageInfo { hasNextPage endCursor } nodes { handle } }
  }`, { c: cc });
  for (const c of d.collections.nodes) handles.add(c.handle);
  cc = d.collections.pageInfo.hasNextPage ? d.collections.pageInfo.endCursor : null;
} while (cc);

// 3) Config de landing. desc = placeholder de 1 línea (pulir después en el Admin).
//   smart:    { key, values, disjunctive? } → regla si el metafield está disponible.
//   fallback: idem, si la primaria no está disponible.
//   manual:true → SIEMPRE manual (curaduría), con `reason`.
const LANDING = [
  {
    handle: 'rinden-todo-el-dia',
    title: 'Rinden todo el día',
    desc: 'Perfumes de máxima duración en piel: rinden toda la jornada.',
    // "valor de mayor duración" = el tope de la lista cerrada de longevidad.
    smart: { key: 'longevidad', values: ['Eterna (12h+)'] },
  },
  {
    handle: 'para-la-noche',
    title: 'Para la noche',
    desc: 'Fragancias con carácter para salidas y eventos de noche.',
    smart: { key: 'ocasion', values: ['Noche'] },
  },
  {
    handle: 'frescos-para-el-verano',
    title: 'Frescos para el verano',
    desc: 'Aromas ligeros y refrescantes para los días de calor.',
    smart: { key: 'estacion', values: ['Verano'] },
    // Si estacion no está disponible → familias frescas (Cítrico / Fresco-Acuático).
    fallback: { key: 'familia_olfativa', values: ['Cítrico', 'Fresco/Acuático'], disjunctive: true },
  },
  {
    handle: 'alternativas-a-los-clasicos',
    title: 'Alternativas a los clásicos',
    desc: 'Selección curada de perfiles inspirados en clásicos reconocidos.',
    manual: true,
    reason: 'LEGAL: equivalencias — máxima exposición. Curaduría 100% manual, sin regla automática.',
  },
  {
    handle: 'los-mas-elegidos',
    title: 'Los más elegidos',
    desc: 'Los favoritos de la tienda.',
    manual: true,
    reason: 'Sin data de ventas todavía → curaduría manual (después se puede automatizar por mejor-vendidos).',
  },
  {
    handle: 'para-regalar',
    title: 'Para regalar',
    desc: 'Ideas de regalo para cada persona y ocasión.',
    manual: true,
    reason: 'Curaduría editorial.',
  },
  {
    handle: 'arranca-con-decants',
    title: 'Para arrancar: probá con decants',
    desc: 'Empezá barato: probá el aroma en decant antes de ir por el frasco.',
    manual: true,
    reason: 'Todos los productos tienen decant y una regla VARIANT_PRICE no aísla el frasco → manual (falta definir umbral).',
  },
];

// Regla smart desde un {key, values, disjunctive}.
function buildRuleSet(spec) {
  const gid = defByKey[spec.key].id;
  const rules = spec.values.map((v) => ({
    column: 'PRODUCT_METAFIELD_DEFINITION', relation: 'EQUALS', condition: v, conditionObjectId: gid,
  }));
  return { appliedDisjunctively: Boolean(spec.disjunctive) || rules.length > 1, rules };
}

const CREATE = `
  mutation($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }
`;

// Resuelve el modo (smart / smart-fallback / manual) + el ruleSet + el porqué.
function resolve(c) {
  if (c.manual) return { mode: 'manual', ruleSet: null, why: c.reason };
  const st = smartStatus(c.smart.key);
  if (st === 'ok') {
    return { mode: 'smart', ruleSet: buildRuleSet(c.smart), why: `regla ${c.smart.key} = ${c.smart.values.join(' | ')}` };
  }
  if (c.fallback && smartStatus(c.fallback.key) === 'ok') {
    return {
      mode: 'smart*', ruleSet: buildRuleSet(c.fallback),
      why: `${c.smart.key}: ${st} → fallback ${c.fallback.key} = ${c.fallback.values.join(' | ')}`,
    };
  }
  return { mode: 'manual', ruleSet: null, why: `${c.smart.key}: ${st} → MANUAL (asignás a mano)` };
}

const TAG = { smart: '[SMART] ', 'smart*': '[SMART*]', manual: '[MANUAL]' };
const summary = { smart: [], manual: [] };
let created = 0;
let skipped = 0;

console.log(`Landing collections${DRY ? ' · DRY-RUN (no escribe)' : ''}:\n`);
for (const c of LANDING) {
  const { mode, ruleSet, why } = resolve(c);
  (mode === 'manual' ? summary.manual : summary.smart).push(`${TAG[mode]} ${c.title} {${c.handle}} — ${why}`);

  if (handles.has(c.handle)) {
    console.log(`  · ${TAG[mode]} ${c.title} {${c.handle}} — ya existe, salteada`);
    skipped++;
    continue;
  }
  const input = { title: c.title, handle: c.handle, descriptionHtml: `<p>${c.desc}</p>`, ...(ruleSet ? { ruleSet } : {}) };
  if (DRY) {
    console.log(`  + crearía ${TAG[mode]} "${c.title}" {${c.handle}} — ${why}`);
    created++;
    continue;
  }
  const data = await gql(CREATE, { input });
  const { collection, userErrors } = data.collectionCreate;
  if (collection) {
    console.log(`  ✓ ${TAG[mode]} ${collection.title} {${collection.handle}}`);
    created++;
  } else {
    console.error(`  ✗ ${c.title}:`, JSON.stringify(userErrors));
    process.exitCode = 1;
  }
}

console.log('\n── Resumen (smart vs manual) ──');
console.log(`SMART (${summary.smart.length}):`);
for (const s of summary.smart) console.log('  ·', s);
console.log(`MANUAL (${summary.manual.length}):`);
for (const s of summary.manual) console.log('  ·', s);
console.log(`\nListo: ${created} ${DRY ? 'a crear' : 'creadas'}, ${skipped} ya existían.`);
console.log('[SMART*] = usó el fallback. Las MANUAL requieren asignar productos a mano en Admin → Colecciones.');
