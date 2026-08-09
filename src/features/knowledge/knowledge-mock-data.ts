import type { KnowledgeActivity, KnowledgeCategory, KnowledgeDocument } from "@/features/knowledge/knowledge-types";

export const knowledgeCategories: readonly KnowledgeCategory[] = [
  { id: "policies", name: "公司制度", documentCount: 128, tone: "purple" },
  { id: "projects", name: "项目文档", documentCount: 356, tone: "blue" },
  { id: "training", name: "培训资料", documentCount: 245, tone: "green" },
  { id: "contracts", name: "合同模板", documentCount: 89, tone: "orange" },
  { id: "sop", name: "SOP流程", documentCount: 172, tone: "cyan" },
  { id: "faq", name: "常见问题", documentCount: 64, tone: "purple" },
];

export const knowledgeDocuments: readonly KnowledgeDocument[] = [
  { id: "doc-1", title: "企业员工手册（2026版）.pdf", summary: "员工入职、日常协作、休假与合规行为的统一制度说明。", categoryId: "policies", type: "pdf", author: "张伟", updatedAt: "2026-08-05T09:30:00.000Z", views: 1284, tags: ["制度流程", "人事管理"] },
  { id: "doc-2", title: "项目管理流程规范 v1.2.docx", summary: "覆盖项目立项、任务拆解、风险管理与复盘的标准项目管理流程。", categoryId: "projects", type: "docx", author: "王芳", updatedAt: "2026-08-04T16:45:00.000Z", views: 986, tags: ["项目管理", "SOP"] },
  { id: "doc-3", title: "销售技巧培训课件.pptx", summary: "面向客户顾问的需求发现、方案沟通和客户交付实践课程。", categoryId: "training", type: "pptx", author: "赵敏", updatedAt: "2026-08-03T10:20:00.000Z", views: 782, tags: ["培训学习", "客户服务"] },
  { id: "doc-4", title: "客户服务 SOP 流程图 v2.1.pdf", summary: "客户交付过程中的响应、升级与问题闭环处理规范。", categoryId: "sop", type: "pdf", author: "陈晨", updatedAt: "2026-08-02T14:30:00.000Z", views: 641, tags: ["客户服务", "SOP"] },
  { id: "doc-5", title: "软件开发服务合同模板.docx", summary: "技术服务项目通用合同条款与交付验收附件模板。", categoryId: "contracts", type: "docx", author: "刘洋", updatedAt: "2026-08-01T11:05:00.000Z", views: 532, tags: ["合同协议", "产品资料"] },
  { id: "doc-6", title: "项目立项申请表模板.xlsx", summary: "项目目标、预算、负责人、里程碑及资源需求的立项模板。", categoryId: "projects", type: "xlsx", author: "张伟", updatedAt: "2026-07-31T09:15:00.000Z", views: 478, tags: ["项目管理", "表单模板"] },
  { id: "doc-7", title: "OKR 制定与复盘指南.pdf", summary: "企业目标拆解、关键结果量化与季度复盘的完整方法。", categoryId: "training", type: "pdf", author: "李琪", updatedAt: "2026-07-29T15:40:00.000Z", views: 756, tags: ["OKR", "培训学习"] },
  { id: "doc-8", title: "信息安全常见问题汇总.docx", summary: "账号安全、文件分享、数据分级与异常上报的常见问题。", categoryId: "faq", type: "docx", author: "陈晨", updatedAt: "2026-07-28T12:10:00.000Z", views: 438, tags: ["信息安全", "常见问题"] },
];

export const knowledgeActivities: readonly KnowledgeActivity[] = [
  { id: "activity-1", actor: "张伟", content: "上传了文档《产品需求文档模板 v1.0》", createdAt: "10 分钟前" },
  { id: "activity-2", actor: "王芳", content: "更新了《项目管理流程规范 v1.2》", createdAt: "1 小时前" },
  { id: "activity-3", actor: "系统管理员", content: "创建了文件夹《2026 年培训资料》", createdAt: "3 小时前" },
  { id: "activity-4", actor: "李琪", content: "归档了《旧版员工手册（2022版）》", createdAt: "昨天 18:20" },
];
