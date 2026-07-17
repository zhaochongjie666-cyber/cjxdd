/**
 * Normal Flow 的对外入口。跟 extensions/xdd/index.ts 同样的形状：pi 用
 * `export default factory` 加载 inline extension；同时把常用符号 re-export
 * 出去，方便测试和其他脚本直接 import。
 */
import { normalFlowInlineExtension } from "./extension.ts";

export {
	activateNormalFlowExtension,
	deactivateNormalFlowExtension,
	getState,
	isNfOwnedRuntime,
	normalFlowInlineExtension,
} from "./extension.ts";
// pi ExtensionAPI expects a default-exported factory function.
export default normalFlowInlineExtension.factory;
export { resumeNormalFlow, startNormalFlow } from "./flow.ts";
export { NF_STAGES } from "./stages.ts";
export { NF_DISPLAY_NAME, NF_STAGE_NAMES, planStageNamesAreNf } from "./types.ts";
export { translateXddText } from "./xdd-text-bridge.ts";
