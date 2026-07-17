/**
 * Re-export xdd 的文件系统硬 Gate helper，供 NF 的 stages.ts / tools 使用。
 * NF 不新增任何 gate 逻辑——所有硬检查都是 requireGlobs 系列的组合。
 */
export {
	gitHasChanges,
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	requirePatternInSource,
	requireTestsPass,
	runBuild,
	softPass,
} from "../xdd/gate.ts";
