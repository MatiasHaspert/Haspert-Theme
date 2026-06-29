// Reglas de precio del negocio, centralizadas en un solo lugar.
// Decants y tester se derivan SIEMPRE del precio del frasco (nada hardcodeado).
// Contexto inflacionario AR: cambiás `precio_frasco` en la fuente y re-corrés el loader → repreciá todo.

// Multiplicadores sobre el $/ml del frasco (memoria del proyecto):
//   decant 10ml = $/ml × 2,0   ·   decant 5ml = $/ml × 2,3
//   tester ≈ precio del frasco − 10%
export const PRICING = {
  decant10: { ml: 10, mult: 2.0 },
  decant5: { ml: 5, mult: 2.3 },
  testerFactor: 0.9,
  roundTo: 100, // redondeo a $100 ARS; subí/bajá si querés otro escalón
};

/** Redondea al múltiplo configurado (por defecto $100). */
export function roundPrice(value, step = PRICING.roundTo) {
  if (!step || step <= 0) return Math.round(value);
  return Math.round(value / step) * step;
}

/**
 * Calcula los precios de las 4 presentaciones desde el precio del frasco.
 * @param {number} precioFrasco precio del frasco completo (ARS)
 * @param {number} frascoMl     volumen del frasco (ml)
 * @returns {{ frasco:number, decant10:number, decant5:number, tester:number, pml:number }}
 */
export function computePrices(precioFrasco, frascoMl) {
  if (!(precioFrasco > 0)) throw new Error(`precio_frasco inválido: ${precioFrasco}`);
  if (!(frascoMl > 0)) throw new Error(`frasco_ml inválido: ${frascoMl}`);

  const pml = precioFrasco / frascoMl;
  return {
    pml,
    frasco: roundPrice(precioFrasco),
    decant10: roundPrice(pml * PRICING.decant10.ml * PRICING.decant10.mult),
    decant5: roundPrice(pml * PRICING.decant5.ml * PRICING.decant5.mult),
    tester: roundPrice(precioFrasco * PRICING.testerFactor),
  };
}
