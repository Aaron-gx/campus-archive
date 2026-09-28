import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 五大分类 + 子类：针对大学生场景预设，用户开箱即用
const seedCategories = [
  {
    key: "identity",
    name: "身份证件",
    icon: "🪪",
    order: 1,
    sensitive: true,
    children: [
      { key: "identity-idcard", name: "身份证" },
      { key: "identity-student", name: "学生证" },
      { key: "identity-household", name: "户口本" },
      { key: "identity-residence", name: "居住证" },
      { key: "identity-birth", name: "出生证明" },
      { key: "identity-passport", name: "护照/港澳台通行证" },
      { key: "identity-license", name: "驾驶证" },
      { key: "identity-bankcard", name: "银行卡" },
    ],
  },
  {
    key: "certificate",
    name: "证书",
    icon: "🏆",
    order: 2,
    sensitive: false,
    children: [
      { key: "certificate-award", name: "获奖证书" },
      { key: "certificate-qualify", name: "资格证书" },
      { key: "certificate-level", name: "等级证书（四六级/计算机等）" },
      { key: "certificate-graduation", name: "毕业/学位证书" },
    ],
  },
  {
    key: "experience",
    name: "经历证明",
    icon: "📄",
    order: 3,
    sensitive: false,
    children: [
      { key: "experience-intern", name: "实习证明" },
      { key: "experience-volunteer", name: "志愿服务证明" },
      { key: "experience-social", name: "社会实践" },
      { key: "experience-club", name: "社团/学生工作" },
    ],
  },
  {
    key: "photo",
    name: "活动照片",
    icon: "📸",
    order: 4,
    sensitive: false,
    children: [
      { key: "photo-competition", name: "比赛/竞赛现场" },
      { key: "photo-volunteer", name: "志愿活动" },
      { key: "photo-ceremony", name: "颁奖典礼" },
      { key: "photo-daily", name: "日常记录" },
    ],
  },
  {
    key: "portfolio",
    name: "作品集",
    icon: "🎨",
    order: 5,
    sensitive: false,
    children: [
      { key: "portfolio-design", name: "设计作品" },
      { key: "portfolio-code", name: "代码/项目" },
      { key: "portfolio-writing", name: "文章/写作" },
      { key: "portfolio-other", name: "其他作品" },
    ],
  },
];

async function main() {
  for (const cat of seedCategories) {
    const parent = await prisma.category.upsert({
      where: { key: cat.key },
      update: { name: cat.name, icon: cat.icon, order: cat.order, sensitive: cat.sensitive },
      create: {
        key: cat.key,
        name: cat.name,
        icon: cat.icon,
        order: cat.order,
        sensitive: cat.sensitive,
      },
    });
    for (const child of cat.children) {
      await prisma.category.upsert({
        where: { key: child.key },
        update: { name: child.name, parentId: parent.id },
        create: { key: child.key, name: child.name, parentId: parent.id, icon: cat.icon, order: 0 },
      });
    }
  }
  console.log("✅ 五大分类及子类已就绪");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
