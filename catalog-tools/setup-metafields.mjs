// Fuente de verdad del SCHEMA de metafields que el theme lee. Idempotente:
// crea lo que falta y ACTUALIZA las opciones (choices) de lo que ya existe.
// Da editores tipados + dropdowns + validación en el admin
// (Settings → Custom data → Products / Variants), para que un no-dev edite sin romper filtros.
//
//   node setup-metafields.mjs
//
// Contrato verificado en el theme (no cambiar namespace/key/type sin tocar el Liquid):
//   PRODUCT:  sections/main-product.liquid · snippets/card-product.liquid
//             sections/related-by-family.liquid · snippets/cart-cross-sell.liquid
//   VARIANT:  sections/main-product.liquid (confianza, nota decant, badge de lote, $/ml)
//             sections/kit-decants.liquid (kit condicional)

import { gql, loadDotEnv } from './lib/shopify.mjs';

await loadDotEnv();

const LIST = 'list.single_line_text_field';
const TEXT = 'single_line_text_field';
const BOOL = 'boolean';
const INT = 'number_integer';

// Cada campo: { name, key, type, description, choices?, listMin?, listMax? }.
// `choices` (lista cerrada) → dropdown en el admin + valores consistentes para
// chips/filtros/colecciones. Campos abiertos (notas, país, inspirado_en) van sin choices.
const PRODUCT_FIELDS = [
  {
    name: 'Familia olfativa', key: 'familia_olfativa', type: LIST,
    description: 'Familias olfativas. Maneja chips, cross-sell y relacionados. Lista cerrada.',
    choices: [
      'Amaderado', 'Oriental/Ámbar', 'Floral', 'Cítrico', 'Aromático', 'Especiado',
      'Dulce/Gourmand', 'Frutal', 'Fresco/Acuático', 'Cuero', 'Chipre', 'Fougère', 'Almizclado',
    ],
    listMin: 1, listMax: 20,
  },
  { name: 'Notas de salida', key: 'notas_salida', type: LIST, description: 'Notas de la pirámide (salida). Texto libre (hay cientos de notas).' },
  { name: 'Notas de corazón', key: 'notas_corazon', type: LIST, description: 'Notas de la pirámide (corazón). Texto libre.' },
  { name: 'Notas de fondo', key: 'notas_fondo', type: LIST, description: 'Notas de la pirámide (fondo). Texto libre.' },
  {
    name: 'Ocasión', key: 'ocasion', type: LIST,
    description: 'Ocasiones de uso. Lista cerrada.',
    choices: ['Diario', 'Oficina', 'Casual/Fin de semana', 'Noche', 'Formal/Evento', 'Cita romántica', 'Deporte'],
  },
  {
    name: 'Estación', key: 'estacion', type: LIST,
    description: 'Estaciones recomendadas. Lista cerrada.',
    choices: ['Primavera', 'Verano', 'Otoño', 'Invierno', 'Todo el año'],
  },
  {
    name: 'Género', key: 'genero', type: TEXT,
    description: 'Público objetivo. Lista cerrada.',
    choices: ['Masculino', 'Femenino', 'Unisex'],
  },
  {
    name: 'Concentración', key: 'concentracion', type: TEXT,
    description: 'Concentración, de más liviana a más concentrada. Lista cerrada.',
    choices: [
      'Eau Fraîche', 'Eau de Cologne (EDC)', 'Eau de Toilette (EDT)', 'Eau de Parfum (EDP)',
      'Eau de Parfum Intense', 'Parfum/Extrait', 'Attar / Aceite',
    ],
  },
  {
    name: 'Longevidad', key: 'longevidad', type: TEXT,
    description: 'Duración aproximada en piel. Lista cerrada.',
    choices: ['Baja (2–4h)', 'Moderada (4–6h)', 'Larga (6–8h)', 'Muy larga (8–12h)', 'Eterna (12h+)'],
  },
  {
    name: 'Estela / proyección', key: 'estela', type: TEXT,
    description: 'Cuánto proyecta el aroma alrededor. Lista cerrada.',
    choices: ['Íntima', 'Moderada', 'Notable', 'Enorme'],
  },
  { name: 'País de origen', key: 'pais_origen', type: TEXT, description: 'País de fabricación. Texto libre (bloque de originalidad).' },
  { name: 'Año de lanzamiento', key: 'anio_lanzamiento', type: INT, description: 'Año de lanzamiento del perfume.' },
  { name: 'Tamaño del frasco (ml)', key: 'tamano_frasco_ml', type: INT, description: 'Tamaño del frasco completo en ml.' },
  { name: 'Inspirado en', key: 'inspirado_en', type: TEXT, description: 'LEGAL: copy prudente, opcional. Nunca afirmar ser la marca original.' },
  { name: 'Original garantizado', key: 'original_garantizado', type: BOOL, description: 'Muestra el bloque de garantía de originalidad en la PDP.' },
];

// Metafields A NIVEL VARIANTE. El "tipo" (sellado/tester/decant) NO se parsea del
// nombre de la variante (frágil): vive acá y el theme lo lee para confianza,
// nota legal de decant, badge de lote y el kit condicional.
const VARIANT_FIELDS = [
  {
    name: 'Tipo de presentación', key: 'tipo_presentacion', type: TEXT,
    description: 'Tipo de presentación de la variante. Maneja confianza, nota legal de decant, badge de lote y el kit condicional en la PDP. Lista cerrada.',
    choices: ['Sellado', 'Tester', 'Decant'],
  },
  {
    name: 'Mililitros (ml)', key: 'ml', type: INT,
    description: 'Mililitros exactos de la variante, para el cálculo preciso de $/ml en la PDP. Si falta, el theme lo deriva del nombre de la variante.',
  },
  {
    name: 'Badge de variante', key: 'badge_variante', type: TEXT,
    description: 'Etiqueta editorial manual sobre la card del selector (ej. "El más elegido"). El badge "Mejor $/ml" lo calcula el theme solo; este es para destacar a mano.',
  },
  {
    name: 'Nota de variante', key: 'nota_variante', type: TEXT,
    description: 'Subtítulo corto opcional en la card del selector (ej. "Probá antes de invertir"). Si está vacío, la card no muestra subtítulo.',
  },
];

function buildValidations(f) {
  const v = [];
  if (f.choices) v.push({ name: 'choices', value: JSON.stringify(f.choices) });
  if (f.listMin != null) v.push({ name: 'list.min', value: String(f.listMin) });
  if (f.listMax != null) v.push({ name: 'list.max', value: String(f.listMax) });
  return v;
}

const CREATE = `
  mutation CreateDef($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const UPDATE = `
  mutation UpdateDef($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id }
      userErrors { field message code }
    }
  }
`;

// Capabilities actuales (smart collection / admin filter): si una definición ya
// se usa en una colección automática, hay que re-enviarlas o el update rebota
// con CAPABILITY_CANNOT_BE_DISABLED. Sólo aplica a PRODUCT (las variantes no
// arman smart collections), así que las prefetcheamos sólo para ese ownerType.
async function fetchCapabilities(ownerType) {
  const data = await gql(`{
    metafieldDefinitions(first: 100, ownerType: ${ownerType}, namespace: "custom") {
      nodes {
        key
        capabilities {
          smartCollectionCondition { enabled }
          adminFilterable { enabled }
        }
      }
    }
  }`);
  const byKey = {};
  for (const n of data.metafieldDefinitions.nodes) {
    byKey[n.key] = {
      smartCollectionCondition: { enabled: n.capabilities.smartCollectionCondition.enabled },
      adminFilterable: { enabled: n.capabilities.adminFilterable.enabled },
    };
  }
  return byKey;
}

// Crea o, si ya existe (TAKEN), actualiza la definición. Devuelve 'created' | 'updated' | 'error'.
async function ensureDefinition(f, ownerType, capByKey) {
  const validations = buildValidations(f);

  // 1) Intento crear.
  const createData = await gql(CREATE, {
    definition: {
      name: f.name,
      namespace: 'custom',
      key: f.key,
      type: f.type,
      description: f.description,
      ownerType,
      pin: true,
      validations,
    },
  });
  const cRes = createData.metafieldDefinitionCreate;
  if (cRes.createdDefinition) return 'created';

  // 2) Ya existía → actualizo nombre/desc/opciones para sincronizar la taxonomía.
  const taken = cRes.userErrors.find((e) => e.code === 'TAKEN');
  if (!taken) {
    console.error(`  ✗ custom.${f.key} (${ownerType}):`, JSON.stringify(cRes.userErrors));
    process.exitCode = 1;
    return 'error';
  }

  const updateDefinition = {
    name: f.name,
    namespace: 'custom',
    key: f.key,
    ownerType,
    description: f.description,
    pin: true,
    validations,
  };
  // Preservar capabilities si la definición ya existe (smart collection / filtro admin).
  if (capByKey && capByKey[f.key]) updateDefinition.capabilities = capByKey[f.key];

  const updateData = await gql(UPDATE, { definition: updateDefinition });
  const uRes = updateData.metafieldDefinitionUpdate;
  if (uRes.updatedDefinition) return 'updated';

  console.error(`  ✗ update custom.${f.key} (${ownerType}):`, JSON.stringify(uRes.userErrors));
  process.exitCode = 1;
  return 'error';
}

let created = 0;
let updated = 0;

async function run(fields, ownerType, label) {
  const capByKey = ownerType === 'PRODUCT' ? await fetchCapabilities(ownerType) : null;
  console.log(`\n${label}:`);
  for (const f of fields) {
    const result = await ensureDefinition(f, ownerType, capByKey);
    const extra = f.choices ? ` · ${f.choices.length} opciones` : '';
    if (result === 'created') {
      created++;
      console.log(`  ✓ creada      custom.${f.key} (${f.type})${extra}`);
    } else if (result === 'updated') {
      updated++;
      console.log(`  ↻ actualizada custom.${f.key}${extra}`);
    }
  }
}

await run(PRODUCT_FIELDS, 'PRODUCT', 'Producto');
await run(VARIANT_FIELDS, 'PRODUCTVARIANT', 'Variante');

console.log(`\nListo: ${created} creadas, ${updated} actualizadas.`);
console.log('Verificá en Admin → Settings → Custom data → Products y → Variants.');
