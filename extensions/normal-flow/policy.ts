/** 单阶段快速本地修复次数；design 耗尽后仍不允许带病推进。 */
export const NF_MAX_SELF_HEAL_PER_STAGE = 3;

/** verify 可触发的完整流程回炉次数。 */
export const NF_MAX_FLOW_RETRIES = 8;

/** 设计必须先冻结；只有代码实现阶段允许带着已记录的问题继续形成原型。 */
export function canSoftPassExhaustedStage(stageName: string): boolean {
	return stageName !== "understand" && stageName !== "verify";
}
