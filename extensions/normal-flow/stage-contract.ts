/** NF 极简阶段契约编译。 */
import type { NfStageSpec } from "./types.ts";

export function compileStageContracts(stages: readonly NfStageSpec[]): readonly Readonly<NfStageSpec>[] {
	for (const s of stages) {
		if (!Array.isArray(s.desiredState) || s.desiredState.length === 0) {
			throw new Error(`[nf] stage ${s.name} 缺少 desiredState`);
		}
	}
	return Object.freeze(stages.map(Object.freeze));
}
