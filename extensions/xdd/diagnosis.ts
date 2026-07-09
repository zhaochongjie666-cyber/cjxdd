import { STAGES } from "./stages.ts";
import { DIAGNOSE_LAYERS, type XddDiagnoseLayer, type XddStageName } from "./types.ts";

export function isDiagnoseLayer(value: string): value is XddDiagnoseLayer {
	return (DIAGNOSE_LAYERS as readonly string[]).includes(value);
}

export function isStageName(value: string): value is XddStageName {
	return STAGES.some((s) => s.name === value);
}
