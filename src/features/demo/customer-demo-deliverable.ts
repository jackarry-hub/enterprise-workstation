export const CUSTOMER_DEMO_DELIVERABLE_NAME = "星云智造-AI工作站试点验收记录.txt";

const customerDemoDeliverableContent = `星云智造 AI 企业工作站试点验收记录

交付范围：人员身份切换、目标拆解、任务下发、员工执行、负责人验收、领导总验收与归档。
执行岗位：陈晨｜产品研发中心｜前端工程师
验收结果：10 个演示身份可切换，任务状态和成果文件跨角色实时共享。
回归结论：关键流程通过，阻断级问题为 0，可进入客户试点验收。
`;

export function createCustomerDemoDeliverableFile() {
  return new File(
    [customerDemoDeliverableContent],
    CUSTOMER_DEMO_DELIVERABLE_NAME,
    { type: "text/plain;charset=utf-8" },
  );
}
