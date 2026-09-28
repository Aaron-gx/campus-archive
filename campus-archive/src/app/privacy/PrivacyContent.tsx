"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Printer, ArrowUp, ListFilter, X, ChevronRight } from "lucide-react";

export interface PolicySubSection {
  number: string;
  title: string;
  content: string;
}

export interface PolicySection {
  id: string;
  index: number;
  title: string;
  shortTitle: string;
  lead?: string;
  items: PolicySubSection[];
}

export const POLICY_SECTIONS: PolicySection[] = [
  {
    id: "section-1",
    index: 1,
    title: "第一条 数据收集范围与最小必要原则",
    shortTitle: "数据收集范围",
    lead: "我们严格遵循个人信息保护的“最小必要”原则，仅在提供个人电子档案整理与存储服务所必需的范围内收集与处理数据，不进行非必要的索权与后台静默追踪。",
    items: [
      {
        number: "1.1",
        title: "基础账号信息",
        content:
          "仅收集用户主动填写的注册联系方式（手机号码或电子邮箱）、登录密码加盐单向哈希凭据（密码明文绝不落盘存储）、自定义昵称以及所属院校或机构名称。所属院校仅用于辅助构建用户本地归档目录索引，不作跨平台商业共享。",
      },
      {
        number: "1.2",
        title: "主动归档材料资产",
        content:
          "仅处理用户在登录状态下主动上传提交的证件材料、资质证书、荣誉表彰、学籍学历文件、经历证明与证件照片。处理范围严格限于文件本身及用户自主录入或确认的元数据（包括标题、颁发机构、获得日期及自主备注）。",
      },
      {
        number: "1.3",
        title: "明确不予收集的信息清单",
        content:
          "我们绝不索取与档案数字化无关的系统特权；绝不读取用户的设备通讯录、剪贴板历史、实时地理位置（GPS）或相册中未选中的照片；身份证件号码等敏感信息不作为全局明文索引入库，统一以高强度密文实体受控管理。",
      },
    ],
  },
  {
    id: "section-2",
    index: 2,
    title: "第二条 敏感材料端到端加密与密钥体系",
    shortTitle: "端到端加密体系",
    lead: "平台对身份证、户口簿、通行证等全部敏感证件材料实施工业级端到端加密存储架构，从架构底层杜绝未经授权的物理访问与数据库未授权遍历风险。",
    items: [
      {
        number: "2.1",
        title: "客户端主密钥派生机制",
        content:
          "用户档案的主加密密钥直接由用户本人的独立账户密码在客户端设备本地环境派生生成。服务端仅存储经高强度算法包裹的密文凭证，服务端运维人员及数据库管理员均无法还原或获取用户的明文解密密钥。",
      },
      {
        number: "2.2",
        title: "一文件一密（Per-File Key）隔离",
        content:
          "每份敏感文件在加密落盘时均独立生成专属工作密钥（DEK）与不可复用的随机初始化向量（IV）。文件经客户端加密流转后独立存储，即使单份密文受到分析攻击，也不会影响其他档案资产，彻底隔离单密钥串联风险。",
      },
      {
        number: "2.3",
        title: "全链路传输安全防护",
        content:
          "全站通信强制启用高安全等级的传输层加密协议（TLS 1.3），杜绝任何明文网络传输通道，确保文件在上传、预览与下载全周期免受公网嗅探、DNS 劫持或中间人攻击。",
      },
    ],
  },
  {
    id: "section-3",
    index: 3,
    title: "第三条 敏感材料受控查验与临时安全窗口",
    shortTitle: "受控查验机制",
    lead: "为应对图书馆、阅览室、办公室及自习室等公共开放场景下设备暂离、借用或被窥视的风险，平台对敏感材料建立强制性的二次身份验证保护机制。",
    items: [
      {
        number: "3.1",
        title: "查验门禁与二次验证",
        content:
          "用户查阅已加密的敏感证件（如居民身份证、户口簿、通行证等）、下载单份敏感原件、或者在导出模块打包生成包含敏感证件的数据包时，均须当场验证账户密码完成二次身份鉴权。",
      },
      {
        number: "3.2",
        title: "十分钟独立安全窗口",
        content:
          "鉴权核验通过后，系统仅为当前会话开辟有效周期为十分钟（600秒）的临时安全查验窗口，便于用户连续办理档案调阅；窗口倒计时结束后安全闸门立即自动闭锁，内存中的解密凭据即刻释放清空，再次查看必须重新完成身份核验。",
      },
      {
        number: "3.3",
        title: "受信任设备免密策略",
        content:
          "在个人私有独占设备上，用户可自主选择启用受信任设备标识（有效期最长 30 天）。信任凭据以加密哈希形式严格受控管理，用户执行登出、修改密码或在设置中远程吊销时凭据立即作废。",
      },
    ],
  },
  {
    id: "section-4",
    index: 4,
    title: "第四条 本地端侧处理与拍摄隐私脱敏",
    shortTitle: "本地端侧脱敏",
    lead: "平台优先采用端侧计算能力，确保敏感个人信息在离开用户本地设备前完成去痕与安全脱敏处理。",
    items: [
      {
        number: "4.1",
        title: "EXIF 拍摄物理元数据清洗",
        content:
          "数码相机与手机拍摄的原始图片通常包含精确的地理经纬度、海拔高度、拍摄设备序列号及相机参数。平台在文件进入存储前，自动在设备端侧剥离所有 EXIF 隐私标签，切除用户的物理行踪印记。",
      },
      {
        number: "4.2",
        title: "本地端侧文字识别（OCR）",
        content:
          "证件材料的文字识别与版面字段结构化解析完全运行于用户设备浏览器的端侧沙箱环境中，图像特征提取与文字分析在本地内存完成，绝不向任何外部公共第三方云端平台传输用户的证件原图。",
      },
      {
        number: "4.3",
        title: "原始画质保真与缩略图分离",
        content:
          "用户上传的原始图片（JPG、PNG）以真实物理字节 1:1 保真存储，不强制进行二次损耗性转码，完整保留公章与钢印细节；系统仅独立生成轻量级缩略图用于快速网格浏览，确保档案证明效力不受损害。",
      },
    ],
  },
  {
    id: "section-5",
    index: 5,
    title: "第五条 数据用途界限与严禁商业化",
    shortTitle: "严禁商业化使用",
    lead: "我们将用户的个人数字档案视为用户专属的私有数字资产，严格坚守数据使用边界与商业禁绝承诺。",
    items: [
      {
        number: "5.1",
        title: "严禁大模型算法训练",
        content:
          "承诺绝不将用户的任何证件原图、文字内容、履历记录或档案文本用于训练、微调或评估任何商业化或开源的通用人工智能、大语言模型或计算机视觉识别模型。",
      },
      {
        number: "5.2",
        title: "严禁商业出租、出售与共享",
        content:
          "绝不向任何第三方商业机构、数据中介公司、征信评估机构或营销平台出租、出售、转让或共享用户的任何个人信息与操作行为记录。",
      },
      {
        number: "5.3",
        title: "零商业广告与用户画像分析",
        content:
          "平台全站不接入任何第三方商业广告追踪 SDK，不基于用户的经历背景、获奖情况、就读院校或证件信息生成商业化画像，不开展任何商业定向推广。",
      },
    ],
  },
  {
    id: "section-6",
    index: 6,
    title: "第六条 数据可携带权与完整导出",
    shortTitle: "数据可携带与导出",
    lead: "依据《中华人民共和国个人信息保护法》第四十五条赋予的个人信息可携带权，保障用户对自身数字资产拥有完全掌控权与迁移自由。",
    items: [
      {
        number: "6.1",
        title: "场景化标准归档包导出",
        content:
          "用户可随时在导出打包功能中，按分类、时间跨度或针对评奖评优、求职应聘等预设场景生成标准的 ZIP 归档数据包。",
      },
      {
        number: "6.2",
        title: "解密原件与规范清册同步输出",
        content:
          "导出的归档包内采用清晰的规范化分类目录，包含经端侧安全还原的原始凭证原图与 PDF 文档，并自动附带符合国家档案数字化标准的 CSV 总目与清册表格，采用通用 UTF-8 编码，确保在各类主流办公软件中打开均无乱码。",
      },
    ],
  },
  {
    id: "section-7",
    index: 7,
    title: "第七条 数据删除与账户注销程序",
    shortTitle: "数据删除与注销",
    lead: "依据《中华人民共和国个人信息保护法》第四十七条关于被遗忘权与个人信息彻底删除权的规定，用户享有随时删除材料与注销账户的权利。",
    items: [
      {
        number: "7.1",
        title: "单份材料实时物理擦除",
        content:
          "当用户在卡片或列表中执行“删除材料”时，系统底层即刻执行物理存储文件与缩略图的同步擦除指令，并销毁数据库对应的所有索引与关联条目，不留隐蔽回收站残留数据。",
      },
      {
        number: "7.2",
        title: "账户注销不可逆清理",
        content:
          "用户在安全设置中核验身份并确认注销账户后，系统立即启动不可逆的全量数据物理销毁程序。账号名下的全部加密物理文件、缩略图缓存、个人身份凭证、活跃会话及历史日志将在磁盘上彻底擦除，服务端不保留任何镜像切片或备份快照，注销生效后不可恢复。",
      },
    ],
  },
  {
    id: "section-8",
    index: 8,
    title: "第八条 多端协同与离线存储安全机制",
    shortTitle: "多端协同与离线安全",
    lead: "为保障多设备无缝流转及无网络环境下的查阅需要，系统建立多端同步与端侧离线安全体系。",
    items: [
      {
        number: "8.1",
        title: "移动端本地加密镜像",
        content:
          "移动客户端采用本机独立轻量级加密数据库，用户同步后的档案材料在本地建立加密镜像。在飞行模式、无公网或保密场所等离线环境下，用户依旧可流畅查看已同步的证书与资料。",
      },
      {
        number: "8.2",
        title: "离线状态安全闸门",
        content:
          "离线查验敏感材料时，客户端自动回退至本地密码安全验证模块，确保在断网状态下仍能有效防御设备借用或被盗带来的隐私泄露风险。",
      },
      {
        number: "8.3",
        title: "增量双向加密同步",
        content:
          "当设备重返安全网络环境时，端侧与服务端自动基于时间戳比对差异，精准同步新增材料并保持双向一致，全流程保持加密流传输，兼顾效能与通信安全。",
      },
    ],
  },
  {
    id: "section-9",
    index: 9,
    title: "第九条 国家法律法规与权威标准对标",
    shortTitle: "法律依据与规范对标",
    lead: "简册在系统架构设计、算法选型、日常运维与安全防护全过程中，严格对标以下国家现行法律法规与权威技术规范：",
    items: [
      {
        number: "9.1",
        title: "《中华人民共和国个人信息保护法》",
        content:
          "全面落实第五条最小必要原则、第十三条知情同意处理原则、第二十八条敏感个人信息受控管理要求，以及第四十七条个人信息删除权保障机制。",
      },
      {
        number: "9.2",
        title: "《中华人民共和国数据安全法》与《中华人民共和国网络安全法》",
        content:
          "严格对标网络安全等级保护制度、数据全生命周期安全防护义务及核心合规治理规范。",
      },
      {
        number: "9.3",
        title: "GB/T 18894-2016《电子文件归档与电子档案管理规范》",
        content:
          "对齐国家电子档案在真实性、完整性、可用性与安全性方面的全流程技术标准与分类元数据规范。",
      },
      {
        number: "9.4",
        title: "GB/T 35273-2020《信息安全技术 个人信息安全规范》",
        content:
          "全面遵循个人敏感信息判定、明示同意、传输存储保密性与最小化访问控制要求。",
      },
    ],
  },
  {
    id: "section-10",
    index: 10,
    title: "第十条 用户权利行使与申诉响应机制",
    shortTitle: "用户权利与申诉",
    lead: "我们设立了明确的法定权利保障渠道与安全申诉响应流程，确保用户诉求得到及时合规处理。",
    items: [
      {
        number: "10.1",
        title: "用户法定权利行使通道",
        content:
          "用户对其个人档案信息依法享有知情权、查阅权、复制权、更正权、导出权及注销删除权。除系统内置的即时自助操作界面外，用户亦可随时通过书面通道提出行使权利诉求。",
      },
      {
        number: "10.2",
        title: "严格响应时限承诺",
        content:
          "平台设有专职数据安全与隐私合规责任专员。对于用户提出的任何隐私问询、权益主张或安全合规申诉，我们将在收到申请后的 5 个工作日内启动核实，并在 15 个工作日内完成核验并予以正式书面答复。",
      },
      {
        number: "10.3",
        title: "外部监督与救济途径",
        content:
          "若用户对我们的处理结果存有异议，有权依法向国家网信部门、公安机关或个人信息保护主管部门提起投诉与反映。",
      },
    ],
  },
];

export default function PrivacyContent() {
  const [activeId, setActiveId] = useState<string>("section-1");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const handleIntersect: IntersectionObserverCallback = (entries) => {
      const visibleEntries = entries.filter((entry) => entry.isIntersecting);
      if (visibleEntries.length > 0) {
        const topEntry = visibleEntries.reduce((prev, curr) =>
          prev.boundingClientRect.top < curr.boundingClientRect.top ? prev : curr
        );
        setActiveId(topEntry.target.id);
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersect, {
      root: null,
      rootMargin: "-90px 0px -65% 0px",
      threshold: [0, 0.2, 0.5],
    });

    POLICY_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      const offset = 90;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = el.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
      setActiveId(id);
      setMobileMenuOpen(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const currentSection =
    POLICY_SECTIONS.find((s) => s.id === activeId) || POLICY_SECTIONS[0];

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] font-sans selection:bg-[#0071E3] selection:text-white transition-colors">
      {/* 顶栏 (macOS 风格，打印时自动隐藏) */}
      <header className="print:hidden sticky top-0 z-40 bg-[var(--card)]/85 backdrop-blur-xl border-b border-[var(--line)]">
        <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="简册"
              className="h-7 w-7 rounded-lg object-cover shadow-2xs"
            />
            <span className="text-[17px] font-semibold tracking-tight text-[var(--ink)]">简册</span>
            <span className="text-[var(--ink-soft)] text-[13px]">/</span>
            <span className="text-[13.5px] font-medium text-[var(--ink-secondary)]">隐私政策</span>
          </Link>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--card-alt)] transition-all cursor-pointer"
              title="打印"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>打印</span>
            </button>

            <Link
              href="/"
              className="inline-flex items-center justify-center bg-[var(--card-alt)] hover:bg-[var(--line-strong)] text-[var(--ink)] font-medium text-[13px] rounded-full px-3.5 py-1.5 transition-all"
            >
              返回首页
            </Link>
          </div>
        </div>
      </header>

      {/* 移动端吸顶章节导航 */}
      <div className="print:hidden lg:hidden sticky top-14 z-30 bg-[var(--card)]/95 backdrop-blur-md border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-[var(--ink-soft)] shrink-0">
              §{String(currentSection.index).padStart(2, "0")}
            </span>
            <span className="text-xs font-medium text-[var(--ink)] truncate">
              {currentSection.shortTitle}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-[#0071E3] bg-[#0071E3]/10 hover:bg-[#0071E3]/20 transition-all shrink-0 cursor-pointer"
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>目录</span>
          </button>
        </div>
      </div>

      {/* 移动端目录弹层 */}
      {mobileMenuOpen && (
        <div className="print:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-xs lg:hidden">
          <div className="bg-[var(--card)] rounded-t-2xl max-h-[80vh] flex flex-col shadow-xl border-t border-[var(--line-strong)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <span className="text-[15px] font-semibold text-[var(--ink)]">条款目录</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--card-alt)] transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-3 space-y-1">
              {POLICY_SECTIONS.map((s) => {
                const isActive = activeId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollToSection(s.id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-[13.5px] transition-all flex items-center justify-between cursor-pointer ${
                      isActive
                        ? "bg-[var(--card-alt)] text-[var(--ink)] font-semibold"
                        : "text-[var(--ink-secondary)] hover:bg-[var(--card-alt)] hover:text-[var(--ink)]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-[11.5px] font-mono text-[var(--ink-soft)] w-4 shrink-0">
                        {s.index}.
                      </span>
                      <span className="truncate">{s.shortTitle}</span>
                    </div>
                    {isActive && <ChevronRight className="w-4 h-4 text-[#0071E3] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full py-2 rounded-xl bg-[var(--card-alt)] text-[13px] font-medium text-[var(--ink)] hover:bg-[var(--line-strong)] transition-all cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主体两列布局 */}
      <div className="mx-auto max-w-[1160px] px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex items-start gap-10">
          {/* 左侧固钉目录 (Desktop Sticky Sidebar) */}
          <aside className="hidden lg:block w-56 xl:w-60 shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="text-[11px] font-semibold text-[var(--ink-soft)] tracking-wider uppercase px-3">
                目录
              </div>

              <nav className="space-y-0.5 text-[13px]">
                {POLICY_SECTIONS.map((s) => {
                  const isActive = activeId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => scrollToSection(s.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                        isActive
                          ? "bg-[var(--card-alt)] text-[var(--ink)] font-semibold"
                          : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--card-alt)]"
                      }`}
                    >
                      <span className="font-mono text-[11px] text-[var(--ink-soft)] w-4 shrink-0">
                        {s.index}.
                      </span>
                      <span className="truncate">{s.shortTitle}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="pt-3 border-t border-[var(--line)] px-3 flex items-center justify-between text-[12px] text-[var(--ink-soft)]">
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)] transition-colors py-1 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>回到页首</span>
                </button>

                <span className="font-mono text-[11px]">2026.1</span>
              </div>
            </div>
          </aside>

          {/* 政策文稿 */}
          <main className="flex-1 min-w-0">
            <article className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-7 sm:p-12 lg:p-14 shadow-sm">
              {/* 文档抬头 */}
              <div className="pb-8 mb-8 border-b border-[var(--line)]">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink)] leading-snug">
                  简册个人信息保护与隐私政策
                </h1>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-soft)] font-mono">
                  <span>版本：2026.1</span>
                  <span>·</span>
                  <span>生效日期：2026年9月1日</span>
                </div>

                <div className="mt-5 text-[14px] leading-[1.8] text-[var(--ink-secondary)] text-justify">
                  欢迎阅读《简册个人信息保护与隐私政策》（以下简称“本政策”）。简册致力于为用户提供安全、私密、可控的个人电子档案整理与归档管理服务。本政策旨在向你清晰阐明我们在你使用简册服务全过程中如何处理、保护你的个人信息，以及你依法享有的各项数据自主控制权利。请在使用本服务前仔细阅读并充分理解本政策内容。
                </div>
              </div>

              {/* 核心条款正文流 */}
              <div className="space-y-10">
                {POLICY_SECTIONS.map((section, sIdx) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className={`scroll-mt-24 ${sIdx > 0 ? "pt-10 border-t border-[var(--line)]" : ""}`}
                  >
                    <h2 className="text-[17px] sm:text-[18px] font-bold text-[var(--ink)] tracking-tight mb-3">
                      {section.title}
                    </h2>

                    {section.lead && (
                      <p className="text-[14px] leading-[1.8] text-[var(--ink-secondary)] text-justify mb-4">
                        {section.lead}
                      </p>
                    )}

                    <div className="space-y-4">
                      {section.items.map((item) => (
                        <div key={item.number} className="space-y-1">
                          <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                            {item.number} {item.title}
                          </h3>
                          <p className="text-[13.5px] sm:text-[14px] leading-[1.8] text-[var(--ink-secondary)] text-justify">
                            {item.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* 尾部说明 */}
              <div className="mt-12 pt-8 border-t border-[var(--line)] text-xs text-[var(--ink-soft)] leading-relaxed">
                简册团队严格恪守个人信息保护与数据安全法制要求。若你对本政策内容或个人信息处理有任何疑问、意见或申诉，请通过应用内设置中心或官方反馈通道与我们联络。
              </div>
            </article>
          </main>
        </div>
      </div>

      {/* 极简页脚 */}
      <footer className="print:hidden border-t border-[var(--line)] py-8 bg-[var(--paper)] text-xs text-[var(--ink-soft)]">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="简册" className="h-4 w-4 rounded object-cover" />
            <span className="font-medium text-[var(--ink)]">简册</span>
            <span>·</span>
            <span>个人信息保护与隐私政策</span>
          </div>

          <div className="flex items-center gap-5">
            <Link href="/" className="hover:text-[var(--ink)] transition-colors">
              返回首页
            </Link>
            <Link href="/login" className="hover:text-[var(--ink)] transition-colors">
              登录控制台
            </Link>
          </div>

          <div className="font-mono text-[var(--ink-soft)]">
            © 2026 简册 · 保留所有权利
          </div>
        </div>
      </footer>
    </div>
  );
}
