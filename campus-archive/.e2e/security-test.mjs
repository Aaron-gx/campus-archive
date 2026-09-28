// 安全回归验证测试套件：node --env-file=.env .e2e/security-test.mjs
// 专门针对《后端代码安全与质量审查报告》中修复的 18 项安全与质量缺陷进行动态断言

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const B = process.env.TEST_URL || "http://localhost:3000";
const prisma = new PrismaClient();
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const bad = (m) => { console.log("  ✗ " + m); fail++; };

const jars = new Map();
async function call(jar, method, path, { json, form, headers: customHeaders } = {}) {
  const headers = { ...(customHeaders || {}) };
  const cookies = jars.get(jar);
  if (cookies?.size) headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(B + path, { method, headers, body, redirect: "manual" });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (!jars.has(jar)) jars.set(jar, new Map());
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jars.get(jar).set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return res;
}

const status = (r) => r.status;

async function cleanupTestUsers() {
  for (const acc of ["sec_user_a@stu.edu.cn", "sec_user_b@stu.edu.cn", "sec_user_c@stu.edu.cn"]) {
    const user = await prisma.user.findUnique({ where: { email: acc } });
    if (user) {
      const userDir = path.join("storage", user.id);
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  }
}

async function main() {
  console.log("==================================================");
  console.log("开始执行后端安全与质量缺陷修复回归测试");
  console.log("==================================================");

  await cleanupTestUsers();

  // 准备测试图片（1x1 假 JPEG）
  const fakeJpg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9,
  ]);

  // 1. 注册测试用户 A
  console.log("\n[Setup] 注册测试用户 A 与 B");
  let r = await call("userA", "POST", "/api/auth/register", {
    json: { account: "sec_user_a@stu.edu.cn", password: "Password123!", nickname: "测试用户A" },
  });
  status(r) === 201 ? ok("用户 A 注册成功") : bad("用户 A 注册失败 " + status(r));

  r = await call("userB", "POST", "/api/auth/register", {
    json: { account: "sec_user_b@stu.edu.cn", password: "Password123!", nickname: "测试用户B" },
  });
  status(r) === 201 ? ok("用户 B 注册成功") : bad("用户 B 注册失败 " + status(r));

  // 获取身份证分类 ID
  const idCat = await prisma.category.findUnique({ where: { key: "identity-idcard" } });

  // 上传一份敏感身份证件
  const fdA = new FormData();
  fdA.append("file", new Blob([fakeJpg], { type: "image/jpeg" }), "idcard.jpg");
  fdA.append("categoryId", idCat.id);
  fdA.append("title", "居民身份证");
  fdA.append("groupId", "group-user-a-001");
  r = await call("userA", "POST", "/api/documents", { form: fdA });
  const docA = (await r.json()).document;
  status(r) === 201 ? ok("用户 A 上传身份证成功 (docId: " + docA.id + ")") : bad("上传失败");

  // =========================================================================
  // 缺陷 1.1 验证：敏感文档在未二次验证状态下，PATCH 与 DELETE 必须被 403 拦截
  // =========================================================================
  console.log("\n== 验证 1.1: 敏感文档未二次验证禁止 PATCH / DELETE ==");
  // 未进行二次验证，尝试 PATCH 修改敏感文档
  r = await call("userA", "PATCH", `/api/documents/${docA.id}`, { json: { note: "试图越权添加备注" } });
  const patchData = await r.json();
  status(r) === 403 && patchData.code === "SENSITIVE_VERIFY_REQUIRED"
    ? ok("未二次验证尝试 PATCH 敏感文档成功被 403 拦截 (SENSITIVE_VERIFY_REQUIRED)")
    : bad("PATCH 拦截失败: " + status(r) + " " + JSON.stringify(patchData));

  // 未进行二次验证，尝试 DELETE 敏感文档
  r = await call("userA", "DELETE", `/api/documents/${docA.id}`);
  const delData = await r.json();
  status(r) === 403 && delData.code === "SENSITIVE_VERIFY_REQUIRED"
    ? ok("未二次验证尝试 DELETE 敏感文档成功被 403 拦截 (SENSITIVE_VERIFY_REQUIRED)")
    : bad("DELETE 拦截失败: " + status(r) + " " + JSON.stringify(delData));

  // 进行二次验证
  r = await call("userA", "POST", "/api/auth/sensitive-verify", { json: { password: "Password123!" } });
  status(r) === 200 ? ok("用户 A 二次验证成功") : bad("二次验证失败: " + status(r));

  // 二次验证后，允许合法 PATCH
  r = await call("userA", "PATCH", `/api/documents/${docA.id}`, { json: { note: "合法验证后备注" } });
  status(r) === 200 ? ok("二次验证后 PATCH 敏感文档成功 200") : bad("PATCH 失败: " + status(r));

  // =========================================================================
  // 缺陷 1.3 验证：服务端强校验拦截敏感材料调用云端 AI
  // =========================================================================
  console.log("\n== 验证 1.3: 服务端实体强校验阻断敏感材料外发云端 AI ==");
  // 传入敏感文档 docId，即使客户端伪造 categoryKey 为 certificate
  r = await call("userA", "POST", "/api/ai/vision-ocr", {
    json: { docId: docA.id, categoryKey: "certificate-award", imageBase64: "data:image/jpeg;base64,1234" },
  });
  status(r) === 400 ? ok("以伪造非敏感分类向 vision-ocr 传入敏感 docId 成功被 400 拦截") : bad("未能拦截: " + status(r));

  r = await call("userA", "POST", "/api/ai/quality-check", {
    json: { docId: docA.id, categoryKey: "certificate-award", imageBase64: "data:image/jpeg;base64,1234" },
  });
  status(r) === 400 ? ok("向 quality-check 传入敏感 docId 成功被 400 拦截") : bad("未能拦截: " + status(r));

  r = await call("userA", "POST", "/api/ai/extract-fields", {
    json: { docId: docA.id, categoryKey: "identity-idcard" },
  });
  status(r) === 400 ? ok("向 extract-fields 传入敏感材料成功被 400 拦截") : bad("未能拦截: " + status(r));

  // =========================================================================
  // 缺陷 2.5 验证：上传材料时跨用户 groupId 冒用越权拦截
  // =========================================================================
  console.log("\n== 验证 2.5: 上传材料 cross-user groupId 归属校验 ==");
  // 用户 B 试图将自己的文档挂入属于用户 A 的 groupId: "group-user-a-001"
  const fdB = new FormData();
  fdB.append("file", new Blob([fakeJpg], { type: "image/jpeg" }), "idcardB.jpg");
  fdB.append("categoryId", idCat.id);
  fdB.append("title", "居民身份证");
  fdB.append("groupId", "group-user-a-001");
  r = await call("userB", "POST", "/api/documents", { form: fdB });
  status(r) === 403 ? ok("用户 B 冒用用户 A 的 groupId 上传材料被 403 拒绝") : bad("越权分组未拦截: " + status(r));

  // =========================================================================
  // 缺陷 2.2 & 2.3 验证：二次验证锁定逻辑重构，杜绝合法第2次误锁，5次错误才锁
  // =========================================================================
  console.log("\n== 验证 2.2 & 2.3: 二次验证锁定逻辑重构 ==");
  // 使用全新的用户 C
  r = await call("userC", "POST", "/api/auth/register", {
    json: { account: "sec_user_c@stu.edu.cn", password: "Password123!", nickname: "测试用户C" },
  });
  // 连续 2 次尝试正确密码验证：绝不应出现以前的第 2 次被 429 误锁的问题！
  r = await call("userC", "POST", "/api/auth/sensitive-verify", { json: { password: "Password123!" } });
  const v1 = status(r);
  r = await call("userC", "POST", "/api/auth/sensitive-verify", { json: { password: "Password123!" } });
  const v2 = status(r);
  v1 === 200 && v2 === 200
    ? ok("连续 2 次输入正确密码均返回 200（修复原第2次被 max:1 误锁 Bug）")
    : bad(`连续正确验证异常: 第1次 ${v1}, 第2次 ${v2}`);

  // 连续输入 5 次错误密码
  let locked = false;
  for (let i = 1; i <= 5; i++) {
    r = await call("userC", "POST", "/api/auth/sensitive-verify", { json: { password: "WrongPassword!" } });
    if (i < 5) {
      if (status(r) !== 401) bad(`第 ${i} 次错误密码未返回 401，而是 ${status(r)}`);
    } else {
      // 第 5 次达到上限锁定
      if (status(r) === 429) {
        locked = true;
      }
    }
  }
  locked ? ok("连续 5 次错误密码后触发 429 锁定 15 分钟") : bad("第 5 次未触发锁定: " + status(r));

  // 处于锁定状态时，即使输入正确密码也应当被 429 拒绝
  r = await call("userC", "POST", "/api/auth/sensitive-verify", { json: { password: "Password123!" } });
  status(r) === 429 ? ok("锁定状态下再次尝试仍被 429 拦截") : bad("锁定状态被绕过: " + status(r));

  // =========================================================================
  // 缺陷 3.1 验证：公开验真接口脱敏 watermarkText
  // =========================================================================
  console.log("\n== 验证 3.1: 公开验真接口 watermarkText 脱敏 ==");
  // 用户 A 导出生成存证记录
  r = await call("userA", "POST", "/api/export", {
    json: { categoryKeys: ["identity"], watermarkText: "个人核心机密审查水印" },
  });
  status(r) === 200 ? ok("导出归档包 200") : bad("导出失败 " + status(r));
  await r.arrayBuffer(); // 消费响应流以触发 finalize 回调
  await new Promise((resolve) => setTimeout(resolve, 500)); // 等待落库

  const userAObj = await prisma.user.findUnique({ where: { email: "sec_user_a@stu.edu.cn" } });
  const exportRec = await prisma.exportRecord.findFirst({
    where: { userId: userAObj.id },
    orderBy: { createdAt: "desc" },
  });

  // 匿名查询该存证
  r = await call("anon", "GET", `/api/verify?code=${exportRec.verifyCode}`);
  const verifyData = await r.json();
  if (status(r) === 200 && verifyData.valid) {
    if (verifyData.data.watermarkText === "已标注防伪水印") {
      ok("匿名访问验真接口返回脱敏 watermarkText: '已标注防伪水印'");
    } else {
      bad("匿名访问未脱敏: " + verifyData.data.watermarkText);
    }
  } else {
    bad("验真接口失败: " + status(r));
  }

  // 用户 A 本人查询 -> 返回真实水印
  r = await call("userA", "GET", `/api/verify?code=${exportRec.verifyCode}`);
  const ownerVerifyData = await r.json();
  ownerVerifyData.data?.watermarkText === "个人核心机密审查水印"
    ? ok("归档所有者本人查询返回完整 watermarkText")
    : bad("所有者查询水印异常: " + ownerVerifyData.data?.watermarkText);

  // =========================================================================
  // 缺陷 3.5 验证：证书 DELETE 若关联敏感原件需二次验证
  // =========================================================================
  console.log("\n== 验证 3.5: 证书级联删除敏感文档需二次验证 ==");
  // 创建一个包含敏感文档关联的证书
  const certRec = await prisma.certificate.create({
    data: {
      userId: (await prisma.user.findUnique({ where: { email: "sec_user_a@stu.edu.cn" } })).id,
      name: "敏感测试证书",
      org: "测试机构",
      level: "校级",
      awardedAt: new Date(),
      documentId: docA.id,
    },
  });

  // 重新创建用户 A 的无敏感验证的新会话进行测试
  jars.delete("userA_fresh");
  r = await call("userA_fresh", "POST", "/api/auth/login", {
    json: { account: "sec_user_a@stu.edu.cn", password: "Password123!" },
  });
  status(r) === 200 ? ok("用户 A 以全新会话登录") : bad("登录失败");

  // 未二次验证尝试删除该证书（由于关联敏感 docA，需二次验证）
  r = await call("userA_fresh", "DELETE", `/api/certificates/${certRec.id}`);
  status(r) === 403 && (await r.json()).code === "SENSITIVE_VERIFY_REQUIRED"
    ? ok("未二次验证尝试 DELETE 关联敏感原件的证书被 403 拦截 (SENSITIVE_VERIFY_REQUIRED)")
    : bad("证书敏感删除未被拦截: " + status(r));

  // 二次验证后执行删除
  await call("userA_fresh", "POST", "/api/auth/sensitive-verify", { json: { password: "Password123!" } });
  r = await call("userA_fresh", "DELETE", `/api/certificates/${certRec.id}`);
  status(r) === 200 ? ok("二次验证后 DELETE 关联敏感文档的证书成功 200") : bad("删除失败: " + status(r));

  // 清理测试数据
  await cleanupTestUsers();

  console.log("\n==================================================");
  console.log(`安全测试执行完毕: 通过 ${pass} 项 / 失败 ${fail} 项`);
  console.log("==================================================");

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("测试运行异常:", e);
  process.exit(1);
});
