import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import ThemeToggle from "@/components/ThemeToggle";

// 系统核心大盘指标（Apple 色彩矩阵）
const systemMetrics = [
  {
    label: "材料分类体系",
    value: "5 大核心分类",
    sub: "全周期数字资产全覆盖",
    border: "border-blue-500/25 hover:border-blue-500/40",
    bg: "bg-blue-500/[0.04] dark:bg-blue-500/10",
    text: "text-[#0071E3] dark:text-[#0A84FF]",
  },
  {
    label: "国家标准子类",
    value: "21 项预置模型",
    sub: "物理槽位与格式规范化",
    border: "border-sky-500/25 hover:border-sky-500/40",
    bg: "bg-sky-500/[0.04] dark:bg-sky-500/10",
    text: "text-[#0284C7] dark:text-[#38BDF8]",
  },
  {
    label: "证书评级阶梯",
    value: "7 级评审标准",
    sub: "对标学籍与全国评审",
    border: "border-amber-500/25 hover:border-amber-500/40",
    bg: "bg-amber-500/[0.04] dark:bg-amber-500/10",
    text: "text-[#D97706] dark:text-[#FF9F0A]",
  },
  {
    label: "敏感安全闸门",
    value: "10 分钟受控窗口",
    sub: "独立密码会话超时重锁",
    border: "border-purple-500/25 hover:border-purple-500/40",
    bg: "bg-purple-500/[0.04] dark:bg-purple-500/10",
    text: "text-[#7C3AED] dark:text-[#BF5AF2]",
  },
  {
    label: "全量合规销毁",
    value: "100% 物理自毁",
    sub: "磁盘密文与记录同步抹除",
    border: "border-emerald-500/25 hover:border-emerald-500/40",
    bg: "bg-emerald-500/[0.04] dark:bg-emerald-500/10",
    text: "text-[#059669] dark:text-[#30D158]",
  },
];

// 大厂级四大核心架构支柱
const architecturePillars = [
  {
    title: "端到端密文存储引擎",
    badge: "物理隔离",
    accentColor: "border-t-[#0071E3]",
    cardTint: "bg-gradient-to-b from-blue-500/[0.05] dark:from-blue-500/10 to-transparent",
    badgeClass: "text-[#0071E3] dark:text-[#0A84FF] bg-blue-500/10 border border-blue-500/20",
    dotColor: "text-[#0071E3] dark:text-[#0A84FF]",
    items: [
      "每个文件独立派生加密密钥与认证标识",
      "磁盘物理隔离路径存储与混淆重命名",
      "高敏感证件与普通材料物理分级管理",
      "服务端不驻留明文主密钥",
    ],
  },
  {
    title: "证书总目与评级系统",
    badge: "国家标准",
    accentColor: "border-t-[#AF52DE]",
    cardTint: "bg-gradient-to-b from-purple-500/[0.05] dark:from-purple-500/10 to-transparent",
    badgeClass: "text-[#7C3AED] dark:text-[#BF5AF2] bg-purple-500/10 border border-purple-500/20",
    dotColor: "text-[#7C3AED] dark:text-[#BF5AF2]",
    items: [
      "全国统一七级评审标准结构化收录",
      "原始凭证高清图像防伪双向绑定",
      "跨学年统一检索与统计汇总支持",
      "四维核心元数据项标准化登记",
    ],
  },
  {
    title: "实践履历存证体系",
    badge: "防伪留存",
    accentColor: "border-t-[#34C759]",
    cardTint: "bg-gradient-to-b from-emerald-500/[0.05] dark:from-emerald-500/10 to-transparent",
    badgeClass: "text-[#059669] dark:text-[#30D158] bg-emerald-500/10 border border-emerald-500/20",
    dotColor: "text-[#059669] dark:text-[#30D158]",
    items: [
      "实习实践加盖用人单位公章原件归档",
      "志愿服务与社会实践证明全量存证",
      "学生干部任职聘任证书全周期留痕",
      "支撑奖学金评定与求职履历背调查验",
    ],
  },
  {
    title: "流式打包与导出引擎",
    badge: "标准格式",
    accentColor: "border-t-[#FF9500]",
    cardTint: "bg-gradient-to-b from-amber-500/[0.05] dark:from-amber-500/10 to-transparent",
    badgeClass: "text-[#D97706] dark:text-[#FF9F0A] bg-amber-500/10 border border-amber-500/20",
    dotColor: "text-[#D97706] dark:text-[#FF9F0A]",
    items: [
      "服务端流式分块解密打包生成压缩包",
      "自动对齐生成材料清单与证书汇总表",
      "采用通用中文编码彻底杜绝表格乱码",
      "支撑三大高频业务场景一键调取交付",
    ],
  },
];

// 五大分类与 21 项子类完整规格矩阵
const fullCategories = [
  {
    key: "identity",
    name: "身份证件",
    icon: "🪪",
    count: "7 项标准子类",
    accentColor: "#0071E3",
    badgeBg: "bg-blue-500/10 text-[#0071E3] dark:text-[#0A84FF] border border-blue-500/20",
    borderClass: "border-blue-500/25 hover:border-blue-500/45",
    cardGradient: "bg-gradient-to-b from-blue-500/[0.05] dark:from-blue-500/10 to-transparent",
    dotClass: "bg-[#0071E3] dark:bg-[#0A84FF]",
    href: "/dashboard/category/identity",
    subcategories: [
      { name: "居民身份证", slot: "正面 / 反面双面槽位", format: "高清图像" },
      { name: "学生证", slot: "主页 / 注册页双面槽位", format: "高清图像" },
      { name: "居民户口簿", slot: "户主页 / 本人页双面槽位", format: "高清图像" },
      { name: "居住证", slot: "正面 / 反面双面槽位", format: "高清图像" },
      { name: "出生证明", slot: "单页原件槽位", format: "文档 / 图像" },
      { name: "往来港澳通行证", slot: "主页 / 签注页双面槽位", format: "高清图像" },
      { name: "机动车驾驶证", slot: "主页 / 副页双面槽位", format: "高清图像" },
    ],
  },
  {
    key: "certificate",
    name: "证书资质",
    icon: "🏆",
    count: "5 项标准子类",
    accentColor: "#FF9500",
    badgeBg: "bg-amber-500/10 text-[#D97706] dark:text-[#FF9F0A] border border-amber-500/20",
    borderClass: "border-amber-500/25 hover:border-amber-500/45",
    cardGradient: "bg-gradient-to-b from-amber-500/[0.05] dark:from-amber-500/10 to-transparent",
    dotClass: "bg-[#FF9500] dark:bg-[#FF9F0A]",
    href: "/dashboard/category/certificate",
    subcategories: [
      { name: "获奖证书", slot: "单页原件关联", format: "文档 / 图像" },
      { name: "职业资格证书", slot: "证书信息页", format: "文档 / 图像" },
      { name: "等级证书", slot: "成绩合格单", format: "文档 / 图像" },
      { name: "毕业证书", slot: "学历认证页", format: "文档 / 图像" },
      { name: "学位证书", slot: "学位认证页", format: "文档 / 图像" },
    ],
  },
  {
    key: "experience",
    name: "经历证明",
    icon: "📄",
    count: "4 项标准子类",
    accentColor: "#34C759",
    badgeBg: "bg-emerald-500/10 text-[#059669] dark:text-[#30D158] border border-emerald-500/20",
    borderClass: "border-emerald-500/25 hover:border-emerald-500/45",
    cardGradient: "bg-gradient-to-b from-emerald-500/[0.05] dark:from-emerald-500/10 to-transparent",
    dotClass: "bg-[#34C759] dark:bg-[#30D158]",
    href: "/dashboard/category/experience",
    subcategories: [
      { name: "实习证明", slot: "单位公章原件", format: "文档 / 图像" },
      { name: "志愿服务证明", slot: "时长记录证明", format: "文档 / 图像" },
      { name: "社会实践证明", slot: "团队实践鉴定", format: "文档 / 图像" },
      { name: "聘书", slot: "任职聘任原件", format: "文档 / 图像" },
    ],
  },
  {
    key: "photo",
    name: "证件照",
    icon: "🖼️",
    count: "2 项标准子类",
    accentColor: "#AF52DE",
    badgeBg: "bg-purple-500/10 text-[#7C3AED] dark:text-[#BF5AF2] border border-purple-500/20",
    borderClass: "border-purple-500/25 hover:border-purple-500/45",
    cardGradient: "bg-gradient-to-b from-purple-500/[0.05] dark:from-purple-500/10 to-transparent",
    dotClass: "bg-[#AF52DE] dark:bg-[#BF5AF2]",
    href: "/dashboard/category/photo",
    subcategories: [
      { name: "一寸证件照", slot: "红底 / 蓝底 / 白底", format: "标准尺寸裁切" },
      { name: "二寸证件照", slot: "红底 / 蓝底 / 白底", format: "标准尺寸裁切" },
    ],
  },
  {
    key: "other",
    name: "其他材料",
    icon: "📎",
    count: "3 项标准子类",
    accentColor: "#5856D6",
    badgeBg: "bg-indigo-500/10 text-[#4F46E5] dark:text-[#818CF8] border border-indigo-500/20",
    borderClass: "border-indigo-500/25 hover:border-indigo-500/45",
    cardGradient: "bg-gradient-to-b from-indigo-500/[0.05] dark:from-indigo-500/10 to-transparent",
    dotClass: "bg-[#5856D6] dark:bg-[#818CF8]",
    href: "/dashboard/category/other",
    subcategories: [
      { name: "体检报告", slot: "医疗报告多页", format: "文档" },
      { name: "学术成果", slot: "论文录用 / 专利原件", format: "文档" },
      { name: "作品集", slot: "成果综合附件", format: "压缩包 / 文档" },
    ],
  },
];

// 系统证书 7 级官方评审标准阶梯
const certificateLevels = [
  { name: "国际级", tag: "国际赛事与权威认证", color: "bg-[#0071e3] text-white", border: "hover:border-[#0071e3]" },
  { name: "国家级", tag: "教育部及国家部委级奖项", color: "bg-[#7c3aed] text-white", border: "hover:border-[#7c3aed]" },
  { name: "省部级", tag: "各省教育厅及直辖市级表彰", color: "bg-[#0284c7] text-white", border: "hover:border-[#0284c7]" },
  { name: "市厅级", tag: "地市级政府及行业协会鉴定", color: "bg-[#059669] text-white", border: "hover:border-[#059669]" },
  { name: "校级", tag: "学校综合奖学金与荣誉", color: "bg-[#d97706] text-white", border: "hover:border-[#d97706]" },
  { name: "院系级", tag: "二级学院表彰与竞赛", color: "bg-[#dc2626] text-white", border: "hover:border-[#dc2626]" },
  { name: "其他", tag: "通用专业认证凭据", color: "bg-[#586380] text-white", border: "hover:border-[#586380]" },
];

// 证书结构化元数据项规范
const certMetadataFields = [
  { field: "证书名称", spec: "规范统一全称登记", detail: "国家与校级资质官方全称录入" },
  { field: "颁发机构", spec: "官方认证发证单位", detail: "教育部 / 行业协会 / 高校院系" },
  { field: "获奖时间", spec: "标准时间跨学年检索", detail: "精确至年月日，支持学年分类" },
  { field: "原件关联", spec: "原件高清凭证防伪绑定", detail: "文档或高清图像一对一存证" },
];

// 三大标准化归档导出套件
const exportSuites = [
  {
    title: "评优评奖材料包",
    tag: "综测与评奖",
    accentColor: "#FF9500",
    borderClass: "border-amber-500/25 hover:border-amber-500/45",
    badgeBg: "bg-amber-500/10 text-[#D97706] dark:text-[#FF9F0A] border border-amber-500/20",
    cardGradient: "bg-gradient-to-b from-amber-500/[0.05] dark:from-amber-500/10 to-transparent",
    checkColor: "text-[#D97706] dark:text-[#FF9F0A]",
    manifest: [
      "学生证",
      "获奖证书原件合辑",
      "志愿服务证明",
      "材料清单表格",
      "证书汇总表格",
    ],
  },
  {
    title: "求职应聘材料包",
    tag: "校招与应聘",
    accentColor: "#0071E3",
    borderClass: "border-blue-500/25 hover:border-blue-500/45",
    badgeBg: "bg-blue-500/10 text-[#0071E3] dark:text-[#0A84FF] border border-blue-500/20",
    cardGradient: "bg-gradient-to-b from-blue-500/[0.05] dark:from-blue-500/10 to-transparent",
    checkColor: "text-[#0071E3] dark:text-[#0A84FF]",
    manifest: [
      "毕业证书",
      "学位证书",
      "实习证明原件",
      "等级证书",
      "职业资格证书",
      "作品集",
    ],
  },
  {
    title: "政务办事材料包",
    tag: "政务与出行",
    accentColor: "#34C759",
    borderClass: "border-emerald-500/25 hover:border-emerald-500/45",
    badgeBg: "bg-emerald-500/10 text-[#059669] dark:text-[#30D158] border border-emerald-500/20",
    cardGradient: "bg-gradient-to-b from-emerald-500/[0.05] dark:from-emerald-500/10 to-transparent",
    checkColor: "text-[#059669] dark:text-[#30D158]",
    manifest: [
      "居民身份证",
      "机动车驾驶证",
      "居民户口簿",
      "居住证",
      "往来港澳通行证",
      "出生证明",
    ],
  },
];

// 双端协同生态架构
const platformEcosystem = [
  {
    platform: "网页控制台",
    badge: "服务端一体化",
    accentColor: "#0071E3",
    borderClass: "border-blue-500/25",
    cardGradient: "bg-gradient-to-b from-blue-500/[0.05] dark:from-blue-500/10 to-transparent",
    badgeClass: "text-[#0071E3] dark:text-[#0A84FF] bg-blue-500/10 border border-blue-500/20",
    bulletColor: "bg-[#0071E3] dark:bg-[#0A84FF]",
    features: [
      "全量材料结构化归档与总目检索",
      "五大分类与二十一个子类多级索引管理",
      "全套压缩包流式导出与中文表格生成",
      "账号注销与物理密文一键彻底自毁",
    ],
  },
  {
    platform: "移动客户端",
    badge: "离线镜像优先",
    accentColor: "#34C759",
    borderClass: "border-emerald-500/25",
    cardGradient: "bg-gradient-to-b from-emerald-500/[0.05] dark:from-emerald-500/10 to-transparent",
    badgeClass: "text-[#059669] dark:text-[#30D158] bg-emerald-500/10 border border-emerald-500/20",
    bulletColor: "bg-[#34C759] dark:bg-[#30D158]",
    features: [
      "本机独立离线数据库镜像与待办队列",
      "无网络环境下全量材料本地离线查验",
      "网络感知与自动恢复双向增量同步",
      "断网状态本地安全验证回退保护",
    ],
  },
];

// 国家标准与行业规范对标
const nationalStandards = [
  {
    code: "国家标准 18894-2016",
    title: "电子文件归档与电子档案管理规范",
    badgeClass: "text-[#0071E3] dark:text-[#0A84FF] bg-blue-500/10 border border-blue-500/20",
    borderClass: "border-blue-500/20",
    clauses: ["真实性与完整性保障体系", "电子文件封装与归档数据包格式", "元数据项与目录规范编码"],
  },
  {
    code: "行业标准 0054-2018",
    title: "信息系统密码应用基本要求",
    badgeClass: "text-[#AF52DE] dark:text-[#BF5AF2] bg-purple-500/10 border border-purple-500/20",
    borderClass: "border-purple-500/20",
    clauses: ["存储机密性强加密规范", "存储完整性防篡改校验", "密钥受控隔离管理机制"],
  },
  {
    code: "国家标准 35273-2020",
    title: "信息安全技术 个人信息安全规范",
    badgeClass: "text-[#FF9500] dark:text-[#FF9F0A] bg-amber-500/10 border border-amber-500/20",
    borderClass: "border-amber-500/20",
    clauses: ["个人敏感信息保护要求", "访问控制与独立二次验证闸门", "注销联动物理数据彻底自毁"],
  },
  {
    code: "国家法律法规",
    title: "中华人民共和国个人信息保护法",
    badgeClass: "text-[#34C759] dark:text-[#30D158] bg-emerald-500/10 border border-emerald-500/20",
    borderClass: "border-emerald-500/20",
    clauses: ["单独同意原则机制保障", "二次验证与受控访问窗口", "全生命周期数据保护闭环"],
  },
];

export default async function Home() {
  const user = await getSessionUser();

  return (
    <main className="min-h-screen bg-[#f6f7fb] dark:bg-[var(--paper)] text-[#282e3e] dark:text-[var(--ink)] font-sans selection:bg-[#0071e3] selection:text-white transition-colors">
      {/* ═══ 大厂级企业顶栏 ═══ */}
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-[var(--card)]/90 backdrop-blur-md border-b border-[#d9dde8] dark:border-[var(--line)] shadow-[0_1px_3px_rgba(40,46,62,0.04)]">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="简册" className="h-7 w-7 rounded-lg object-cover shadow-sm" />
              <span className="text-[20px] font-black tracking-tight text-[#0071e3] dark:text-[#0a84ff]">简册</span>
              <span className="hidden sm:inline-block text-[11px] font-bold text-[#586380] dark:text-[var(--ink-soft)] bg-blue-500/5 dark:bg-blue-500/15 border border-blue-500/20 px-2 py-0.5 rounded-full ml-1">
                企业标准版
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-[13.5px] font-bold text-[#282e3e] dark:text-[var(--ink-secondary)]">
              <a href="#overview" className="hover:text-[#0071e3] dark:hover:text-white transition">
                系统全貌
              </a>
              <a href="#architecture" className="hover:text-[#0071e3] dark:hover:text-white transition">
                架构支柱
              </a>
              <a href="#categories" className="hover:text-[#0071e3] dark:hover:text-white transition">
                材料分类
              </a>
              <a href="#certificates" className="hover:text-[#0071e3] dark:hover:text-white transition">
                证书总目
              </a>
              <a href="#export" className="hover:text-[#0071e3] dark:hover:text-white transition">
                导出套件
              </a>
              <a href="#ecosystem" className="hover:text-[#0071e3] dark:hover:text-white transition">
                双端协同
              </a>
              <a href="#compliance" className="hover:text-[#0071e3] dark:hover:text-white transition">
                规范对标
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            {user ? (
              <Link
                href="/dashboard"
                className="btn-quizlet-pill !py-2 !px-5 !text-[13.5px]"
              >
                进入工作台
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="btn-quizlet-link !py-2 !px-3 sm:!px-4 !text-[13.5px]"
                >
                  登录
                </Link>
                <Link
                  href="/register"
                  className="btn-quizlet-pill !py-2 !px-3.5 sm:!px-5 !text-[13.5px]"
                >
                  注册账户
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══ 首屏：大厂级产品控制台视窗展厅 ═══ */}
      <section id="overview" className="relative pt-14 pb-20 sm:pt-20 sm:pb-28 bg-[#f6f7fb] dark:bg-[var(--paper)] border-b border-[#d9dde8] dark:border-[var(--line)] overflow-hidden">
        {/* Apple 拟态柔光环境气场 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[480px] bg-gradient-to-tr from-blue-500/10 via-indigo-500/8 to-purple-500/10 blur-[110px] pointer-events-none -z-0" />

        <div className="relative z-10 mx-auto max-w-[1280px] px-4 sm:px-6 text-center">
          <h1 className="text-3xl sm:text-5xl lg:text-[4rem] font-extrabold tracking-tight text-[#282e3e] dark:text-[var(--ink)] leading-[1.15]">
            简册 · 个人电子档案系统
          </h1>

          <div className="mt-8 flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
            <Link
              href={user ? "/dashboard" : "/login"}
              className="btn-quizlet-pill !py-3 sm:!py-3.5 !px-8 sm:!px-10 !text-[14.5px] sm:!text-[15px]"
            >
              进入工作台
            </Link>
            <a
              href="#architecture"
              className="btn-quizlet-ghost !py-3 sm:!py-3.5 !px-6 sm:!px-8 !text-[14.5px] sm:!text-[15px]"
            >
              查看架构规范
            </a>
          </div>

          {/* ═══ 大厂级高保真控制台工作台视窗模型 ═══ */}
          <div className="mt-14 mx-auto max-w-[1180px] rounded-[24px] border border-[#0071e3]/20 dark:border-blue-500/30 bg-white dark:bg-[var(--card)] shadow-[0_16px_48px_-10px_rgba(0,113,227,0.12)] dark:shadow-[0_16px_48px_-10px_rgba(0,0,0,0.6)] overflow-hidden text-left">
            {/* 视窗标题栏 */}
            <div className="h-11 bg-[#f6f7fb] dark:bg-[var(--card-alt)] border-b border-[#d9dde8] dark:border-[var(--line)] px-4 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
                <div className="h-3 w-3 rounded-full bg-[#febc2e] border border-[#d89e24]" />
                <div className="h-3 w-3 rounded-full bg-[#28c840] border border-[#1aab29]" />
                <span className="ml-3 text-xs font-bold text-[#586380] dark:text-[var(--ink-soft)] truncate max-w-[170px] sm:max-w-none">
                  简册安全工作台 · 已建立受控会话
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#0071e3] dark:text-[#0a84ff] bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0071e3] dark:bg-[#0a84ff]" />
                密文隔离模式
              </div>
            </div>

            {/* 视窗多栏工作区 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
              {/* 左侧：五大分类树 */}
              <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-[#d9dde8] dark:border-[var(--line)] bg-[#ffffff] dark:bg-[var(--card)] p-4 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold text-[#586380] dark:text-[var(--ink-soft)] uppercase tracking-wider mb-3 px-2">
                    档案分类目录
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-[#0071e3] dark:text-[#0a84ff] font-bold text-xs border border-blue-500/20">
                      <span className="flex items-center gap-2">
                        <span>🪪</span>
                        <span>身份证件</span>
                      </span>
                      <span className="bg-[#0071e3] text-white px-2 py-0.5 rounded-full text-[10px]">
                        7 项
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl text-[#282e3e] dark:text-[var(--ink)] font-semibold text-xs hover:bg-amber-500/5 dark:hover:bg-amber-500/10 transition">
                      <span className="flex items-center gap-2">
                        <span>🏆</span>
                        <span>证书资质</span>
                      </span>
                      <span className="text-[#d97706] dark:text-[#ff9f0a] text-[10px] font-bold">5 项</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl text-[#282e3e] dark:text-[var(--ink)] font-semibold text-xs hover:bg-emerald-500/5 dark:hover:bg-emerald-500/10 transition">
                      <span className="flex items-center gap-2">
                        <span>📄</span>
                        <span>经历证明</span>
                      </span>
                      <span className="text-[#059669] dark:text-[#30d158] text-[10px] font-bold">4 项</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl text-[#282e3e] dark:text-[var(--ink)] font-semibold text-xs hover:bg-purple-500/5 dark:hover:bg-purple-500/10 transition">
                      <span className="flex items-center gap-2">
                        <span>🖼️</span>
                        <span>证件照</span>
                      </span>
                      <span className="text-[#7c3aed] dark:text-[#bf5af2] text-[10px] font-bold">2 项</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl text-[#282e3e] dark:text-[var(--ink)] font-semibold text-xs hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition">
                      <span className="flex items-center gap-2">
                        <span>📎</span>
                        <span>其他材料</span>
                      </span>
                      <span className="text-[#4f46e5] dark:text-[#818cf8] text-[10px] font-bold">3 项</span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#d9dde8] dark:border-[var(--line)] text-xs text-[#586380] dark:text-[var(--ink-soft)] flex items-center justify-between px-2">
                  <span>状态</span>
                  <span className="font-bold text-[#059669] dark:text-[#30d158]">全部同步完成</span>
                </div>
              </div>

              {/* 中间：真实证件双面槽位卡片展区 */}
              <div className="lg:col-span-6 bg-[#f6f7fb] dark:bg-[var(--card-alt)] p-4 sm:p-6 flex flex-col justify-between border-b lg:border-b-0 border-[#d9dde8] dark:border-[var(--line)]">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-[#282e3e] dark:text-[var(--ink)]">居民身份证</span>
                      <span className="text-[11px] font-bold text-[#0071e3] dark:text-[#0a84ff] bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                        已加密
                      </span>
                    </div>
                    <span className="text-xs text-[#586380] dark:text-[var(--ink-soft)]">槽位规范双面完备</span>
                  </div>

                  {/* 双面卡片模拟槽位 */}
                  <div className="grid grid-cols-2 gap-3.5 mb-5">
                    <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.04] to-white dark:to-[var(--card)] p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-[#282e3e] dark:text-[var(--ink)]">正面槽位</span>
                        <span className="text-[10px] font-bold text-[#059669] dark:text-[#30d158] bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          人像面
                        </span>
                      </div>
                      <div className="h-20 rounded-xl bg-white/70 dark:bg-[var(--card-alt)] border border-dashed border-blue-500/30 flex flex-col items-center justify-center text-xs text-[#586380] dark:text-[var(--ink-soft)]">
                        <span className="text-lg">🪪</span>
                        <span className="mt-1 font-semibold text-[11px] text-[#0071e3] dark:text-[#0a84ff]">已完成脱敏校验</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-indigo-500/[0.04] to-white dark:to-[var(--card)] p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-[#282e3e] dark:text-[var(--ink)]">反面槽位</span>
                        <span className="text-[10px] font-bold text-[#0071e3] dark:text-[#0a84ff] bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                          国徽面
                        </span>
                      </div>
                      <div className="h-20 rounded-xl bg-white/70 dark:bg-[var(--card-alt)] border border-dashed border-indigo-500/30 flex flex-col items-center justify-center text-xs text-[#586380] dark:text-[var(--ink-soft)]">
                        <span className="text-lg">🛡️</span>
                        <span className="mt-1 font-semibold text-[11px] text-[#4f46e5] dark:text-[#818cf8]">已提取有效期限</span>
                      </div>
                    </div>
                  </div>

                  {/* 结构化参数列表 */}
                  <div className="rounded-2xl border border-[#d9dde8] dark:border-[var(--line)] bg-white dark:bg-[var(--card)] p-4 space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-[#d9dde8]/50 dark:border-[var(--line)]">
                      <span className="text-[#586380] dark:text-[var(--ink-soft)]">证件类型名称</span>
                      <span className="font-bold text-[#282e3e] dark:text-[var(--ink)]">居民身份证</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#d9dde8]/50 dark:border-[var(--line)]">
                      <span className="text-[#586380] dark:text-[var(--ink-soft)]">查验保护机制</span>
                      <span className="font-bold text-[#0071e3] dark:text-[#0a84ff]">十分钟受控验证独立窗口</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-[#586380] dark:text-[var(--ink-soft)]">存储路径隔离</span>
                      <span className="font-bold text-[#059669] dark:text-[#30d158]">独立派生密钥 · 密文隔离</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#d9dde8] dark:border-[var(--line)]">
                  <span className="text-xs text-[#586380] dark:text-[var(--ink-soft)]">最近核验通过</span>
                  <Link
                    href={user ? "/dashboard/category/identity" : "/login"}
                    className="btn-quizlet-pill !py-1.5 !px-4 !text-xs"
                  >
                    查验详情
                  </Link>
                </div>
              </div>

              {/* 右侧：元数据检视台 */}
              <div className="lg:col-span-3 border-t lg:border-t-0 lg:border-l border-[#d9dde8] dark:border-[var(--line)] bg-[#ffffff] dark:bg-[var(--card)] p-5 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold text-[#586380] dark:text-[var(--ink-soft)] uppercase tracking-wider mb-4">
                    系统指标检视
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-[#586380] dark:text-[var(--ink-soft)] mb-1">加密保护级别</div>
                      <div className="text-sm font-bold text-[#0071e3] dark:text-[#0a84ff]">对称强密文落盘</div>
                      <div className="text-[11px] text-[#586380] dark:text-[var(--ink-soft)] mt-0.5">独立文件密钥派生</div>
                    </div>

                    <div className="pt-3 border-t border-[#d9dde8] dark:border-[var(--line)]">
                      <div className="text-xs text-[#586380] dark:text-[var(--ink-soft)] mb-1">元数据脱敏状态</div>
                      <div className="text-sm font-bold text-[#059669] dark:text-[#30d158]">地理位置已擦除</div>
                      <div className="text-[11px] text-[#586380] dark:text-[var(--ink-soft)] mt-0.5">设备序列号物理脱敏</div>
                    </div>

                    <div className="pt-3 border-t border-[#d9dde8] dark:border-[var(--line)]">
                      <div className="text-xs text-[#586380] dark:text-[var(--ink-soft)] mb-1">合规注销联动</div>
                      <div className="text-sm font-bold text-[#7c3aed] dark:text-[#bf5af2]">彻底物理抹除</div>
                      <div className="text-[11px] text-[#586380] dark:text-[var(--ink-soft)] mt-0.5">无任何历史镜像残余</div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#d9dde8] dark:border-[var(--line)]">
                  <Link
                    href="/privacy"
                    className="text-xs font-bold text-[#0071e3] dark:text-[#0a84ff] hover:underline"
                  >
                    查看合规白皮书 →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 板块 1: 量化指标看板（大厂标准矩阵） ═══ */}
      <section className="py-12 bg-white/60 dark:bg-[var(--card)]/40 border-b border-[#d9dde8] dark:border-[var(--line)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6 text-center">
            {systemMetrics.map((m, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-2xl border ${m.border} ${m.bg} shadow-sm transition-all duration-200 hover:-translate-y-0.5`}
              >
                <div className="text-xs font-bold text-[#586380] dark:text-[var(--ink-soft)]">{m.label}</div>
                <div className={`text-xl sm:text-2xl font-black ${m.text} mt-1.5 tracking-tight`}>{m.value}</div>
                <div className="text-[11px] text-[#586380] dark:text-[var(--ink-soft)] mt-1 font-medium">{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 板块 2: 大厂级四大架构支柱 ═══ */}
      <section id="architecture" className="py-20 bg-[#f6f7fb] dark:bg-[var(--paper)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)] mb-8">
            架构支柱
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {architecturePillars.map((p, idx) => (
              <div
                key={idx}
                className={`rounded-[22px] border border-[#d9dde8] dark:border-[var(--line)] border-t-[3px] ${p.accentColor} ${p.cardTint} bg-white dark:bg-[var(--card)] p-6 shadow-sm flex flex-col justify-between hover:shadow-lg transition-all duration-300 hover:-translate-y-1`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${p.badgeClass}`}>
                      {p.badge}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-[#282e3e] dark:text-[var(--ink)] mb-4">
                    {p.title}
                  </h3>

                  <ul className="space-y-2.5 pt-4 border-t border-[#d9dde8]/80 dark:border-[var(--line)]">
                    {p.items.map((item, iIdx) => (
                      <li key={iIdx} className="text-xs text-[#282e3e] dark:text-[var(--ink-secondary)] flex items-start gap-2 leading-relaxed">
                        <span className={`${p.dotColor} font-bold text-sm leading-none`}>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 板块 3: 五大分类 21 项子类完整规格矩阵 ═══ */}
      <section id="categories" className="py-20 bg-white dark:bg-[var(--card)] border-y border-[#d9dde8] dark:border-[var(--line)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)] mb-8">
            材料分类
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {fullCategories.map((cat) => (
              <div
                key={cat.key}
                className={`rounded-[22px] border ${cat.borderClass} ${cat.cardGradient} bg-[#fbfcfd] dark:bg-[var(--card-alt)] p-6 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between pb-3.5 border-b border-[#d9dde8]/80 dark:border-[var(--line)]">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{cat.icon}</span>
                      <span className="text-lg font-bold text-[#282e3e] dark:text-[var(--ink)]">{cat.name}</span>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${cat.badgeBg}`}>
                      {cat.count}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {cat.subcategories.map((sub, sIdx) => (
                      <div
                        key={sIdx}
                        className="flex items-center justify-between text-xs py-1.5 border-b border-[#d9dde8]/40 dark:border-[var(--line)]/60 last:border-b-0"
                      >
                        <div className="flex items-center gap-2 text-[#282e3e] dark:text-[var(--ink)] font-semibold">
                          <span className={`h-1.5 w-1.5 rounded-full ${cat.dotClass}`} />
                          <span>{sub.name}</span>
                        </div>
                        <span className="text-[#586380] dark:text-[var(--ink-soft)] text-[11px] font-medium">{sub.slot}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-[#d9dde8]/80 dark:border-[var(--line)] flex items-center justify-between">
                  <span className="text-xs text-[#586380] dark:text-[var(--ink-soft)]">标准索引就绪</span>
                  <Link
                    href={user ? cat.href : "/login"}
                    className="text-xs font-bold text-[#0071e3] dark:text-[#0a84ff] hover:underline"
                  >
                    进入分类 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 板块 4: 证书 7 级官方评审标准阶梯 ═══ */}
      <section id="certificates" className="py-20 bg-[#f6f7fb] dark:bg-[var(--paper)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)]">
              证书等级
            </h2>
            <Link
              href={user ? "/dashboard/certificates" : "/login"}
              className="text-xs font-bold text-[#0071e3] dark:text-[#0a84ff] hover:underline"
            >
              查看证书总目 →
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
            {certificateLevels.map((lvl, idx) => (
              <div
                key={idx}
                className={`bg-white dark:bg-[var(--card)] rounded-2xl border border-[#d9dde8] dark:border-[var(--line)] p-4 text-center shadow-sm ${lvl.border} hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between min-h-[105px]`}
              >
                <div className={`mx-auto text-xs font-bold px-2.5 py-1 rounded-full ${lvl.color} shadow-sm`}>
                  {lvl.name}
                </div>
                <div className="text-[11px] text-[#586380] dark:text-[var(--ink-soft)] mt-2 font-medium leading-tight">
                  {lvl.tag}
                </div>
              </div>
            ))}
          </div>

          {/* 证书元数据结构化标准 */}
          <div className="rounded-2xl border border-blue-500/20 dark:border-[var(--line)] bg-gradient-to-r from-blue-500/[0.03] via-purple-500/[0.03] to-transparent dark:from-blue-500/5 dark:via-purple-500/5 bg-white dark:bg-[var(--card)] p-6 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {certMetadataFields.map((f, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="text-sm font-bold text-[#282e3e] dark:text-[var(--ink)]">{f.field}</div>
                  <div className="text-xs font-bold text-[#0071e3] dark:text-[#0a84ff]">{f.spec}</div>
                  <div className="text-xs text-[#586380] dark:text-[var(--ink-soft)] mt-0.5">{f.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 板块 5: 三大场景标准化归档导出套件 ═══ */}
      <section id="export" className="py-20 bg-white dark:bg-[var(--card)] border-y border-[#d9dde8] dark:border-[var(--line)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)]">
              导出套件
            </h2>
            <Link
              href={user ? "/dashboard/export" : "/login"}
              className="text-xs font-bold text-[#0071e3] dark:text-[#0a84ff] hover:underline"
            >
              前往打包 →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {exportSuites.map((suite, idx) => (
              <div
                key={idx}
                className={`rounded-[22px] border ${suite.borderClass} ${suite.cardGradient} bg-[#fbfcfd] dark:bg-[var(--card-alt)] p-6 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between`}
              >
                <div>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${suite.badgeBg}`}>
                    {suite.tag}
                  </span>
                  <div className="text-[17px] font-bold text-[#282e3e] dark:text-[var(--ink)] mt-3.5 pb-3 border-b border-[#d9dde8]/80 dark:border-[var(--line)]">
                    {suite.title}
                  </div>

                  <ul className="mt-4 space-y-2.5">
                    {suite.manifest.map((item, itemIdx) => (
                      <li
                        key={itemIdx}
                        className="text-[13px] text-[#586380] dark:text-[var(--ink-secondary)] flex items-center gap-2"
                      >
                        <span className={`${suite.checkColor} font-black text-sm`}>✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-[#d9dde8]/80 dark:border-[var(--line)] flex items-center justify-between">
                  <span className="text-xs text-[#586380] dark:text-[var(--ink-soft)]">全量材料与表格</span>
                  <Link
                    href={user ? "/dashboard/export" : "/login"}
                    className={`text-xs font-bold ${suite.checkColor} hover:underline`}
                  >
                    导出 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 板块 6: 双端协同生态体系 ═══ */}
      <section id="ecosystem" className="py-20 bg-[#f6f7fb] dark:bg-[var(--paper)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)] mb-8">
            双端协同
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {platformEcosystem.map((plat, idx) => (
              <div
                key={idx}
                className={`rounded-3xl border ${plat.borderClass} ${plat.cardGradient} bg-white dark:bg-[var(--card)] p-8 shadow-sm flex flex-col justify-between hover:shadow-lg transition-all duration-300`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-[#282e3e] dark:text-[var(--ink)]">{plat.platform}</h3>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${plat.badgeClass}`}>
                      {plat.badge}
                    </span>
                  </div>

                  <ul className="space-y-3">
                    {plat.features.map((feat, fIdx) => (
                      <li key={fIdx} className="flex items-center gap-2.5 text-xs text-[#282e3e] dark:text-[var(--ink-secondary)]">
                        <span className={`h-1.5 w-1.5 rounded-full ${plat.bulletColor}`} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 pt-6 border-t border-[#d9dde8]/80 dark:border-[var(--line)] flex items-center justify-between text-xs text-[#586380] dark:text-[var(--ink-soft)]">
                  <span>单一账号体系</span>
                  <span className="font-bold text-[#0071e3] dark:text-[#0a84ff]">双向数据对齐</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 板块 7: 国家标准与安全规范对标 ═══ */}
      <section id="compliance" className="py-20 bg-white dark:bg-[var(--card)] border-t border-[#d9dde8] dark:border-[var(--line)]">
        <div className="mx-auto max-w-[1280px] px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#282e3e] dark:text-[var(--ink)] mb-8">
            规范对标
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {nationalStandards.map((std, idx) => (
              <div
                key={idx}
                className={`rounded-2xl border ${std.borderClass} bg-[#fbfcfd] dark:bg-[var(--card-alt)] p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all duration-200`}
              >
                <div>
                  <div className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full mb-3 ${std.badgeClass}`}>
                    {std.code}
                  </div>
                  <div className="text-[16px] font-bold text-[#282e3e] dark:text-[var(--ink)] leading-snug mb-4">
                    {std.title}
                  </div>

                  <ul className="space-y-2 pt-3 border-t border-[#d9dde8]/80 dark:border-[var(--line)]">
                    {std.clauses.map((clause, cIdx) => (
                      <li key={cIdx} className="text-xs text-[#282e3e] dark:text-[var(--ink-secondary)] flex items-start gap-2">
                        <span className="text-[#0071e3] dark:text-[#0a84ff] font-bold">✓</span>
                        <span>{clause}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 大厂级页脚 ═══ */}
      <footer className="border-t border-[#d9dde8] dark:border-[var(--line)] py-12 bg-[#f6f7fb] dark:bg-[var(--paper)] text-xs text-[#586380] dark:text-[var(--ink-soft)]">
        <div className="mx-auto max-w-[1280px] px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="简册" className="h-6 w-6 rounded-md object-cover shadow-sm" />
            <span className="text-lg font-black text-[#0071e3] dark:text-[#0a84ff]">简册</span>
            <span className="text-[#939bb4]">·</span>
            <span className="text-xs font-bold text-[#586380] dark:text-[var(--ink-soft)]">个人电子档案系统</span>
          </div>

          <div className="flex items-center gap-6 font-semibold">
            <Link href={user ? "/dashboard" : "/login"} className="hover:text-[#0071e3] dark:hover:text-white transition">
              工作台
            </Link>
            <Link href={user ? "/dashboard/certificates" : "/login"} className="hover:text-[#0071e3] dark:hover:text-white transition">
              证书总目
            </Link>
            <Link href={user ? "/dashboard/export" : "/login"} className="hover:text-[#0071e3] dark:hover:text-white transition">
              档案导出
            </Link>
            <Link href="/privacy" className="hover:text-[#0071e3] dark:hover:text-white transition">
              隐私政策
            </Link>
          </div>

          <div>
            © 2026 简册
          </div>
        </div>
      </footer>
    </main>
  );
}
