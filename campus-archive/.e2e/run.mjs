// 端到端 API 测试：node --env-file=.env .e2e/run.mjs
// 先清理历史测试数据（可重复运行），再覆盖注册→上传→加密→证书→导出→越权全链路
import { PrismaClient } from "@prisma/client";
import fs from "fs";

import path from "path";

const B = process.env.TEST_URL || "http://localhost:3000";
const prisma = new PrismaClient();
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const bad = (m) => { console.log("  ✗ " + m); fail++; };

// 每个用例独立的 cookie 存储
const jars = new Map();
async function call(jar, method, path, { json, form } = {}) {
  const headers = {};
  const cookies = jars.get(jar);
  if (cookies?.size) headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form; // FormData
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

async function main() {
  // —— 精确清理历史测试数据与测试存储（严格隔离保护真实用户数据） ——
  for (const u of ["test@stu.edu.cn", "13800138000", "13900139000"]) {
    const user = await prisma.user.findUnique({ where: { email: u } }) ??
      await prisma.user.findUnique({ where: { phone: u } });
    if (user) {
      const userDir = path.join("storage", user.id);
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  console.log("== 1. 注册（学校邮箱） ==");
  let r = await call("a", "POST", "/api/auth/register", {
    json: { account: "test@stu.edu.cn", password: "ValidPass2026!", nickname: "测试同学", school: "测试大学" },
  });
  status(r) === 201 ? ok("注册 201") : bad("注册返回 " + status(r));

  console.log("== 2. 重复注册应 409 ==");
  r = await call("b", "POST", "/api/auth/register", {
    json: { account: "test@stu.edu.cn", password: "ValidPass2026!" },
  });
  status(r) === 409 ? ok("重复注册 409") : bad("返回 " + status(r));

  console.log("== 3. 登出后重新登录 ==");
  await call("a", "POST", "/api/auth/logout");
  r = await call("a", "POST", "/api/auth/login", { json: { account: "test@stu.edu.cn", password: "ValidPass2026!" } });
  status(r) === 200 ? ok("登录 200") : bad("登录返回 " + status(r));

  console.log("== 4. 错误密码应 401 ==");
  r = await call("x", "POST", "/api/auth/login", { json: { account: "test@stu.edu.cn", password: "wrongpass1" } });
  status(r) === 401 ? ok("错误密码 401") : bad("返回 " + status(r));

  console.log("== 5. 分类树 ==");
  r = await call("a", "GET", "/api/categories");
  const cats = (await r.json()).categories;
  cats.length === 5 ? ok("五大分类就绪") : bad("分类数 " + cats.length);
  const idSub = cats.find((c) => c.key === "identity").children[0].id;
  const certSub = cats.find((c) => c.key === "certificate").children[0].id;

  console.log("== 6. 上传身份证图片（自动加密） ==");
  const fd1 = new FormData();
  fd1.append("file", new Blob([fs.readFileSync("test-idcard.jpg")], { type: "image/jpeg" }), "idcard.jpg");
  fd1.append("categoryId", idSub);
  fd1.append("title", "身份证-正面");
  fd1.append("note", "2026年8月拍摄");
  r = await call("a", "POST", "/api/documents", { form: fd1 });
  const up1 = await r.json();
  status(r) === 201 ? ok("上传 201") : bad("上传返回 " + status(r) + JSON.stringify(up1));
  up1.document?.isSensitive === true ? ok("身份证件自动标记敏感加密") : bad("isSensitive=" + up1.document?.isSensitive);
  console.log(`    (原图 35KB → 存储 ${up1.document?.size} bytes, ${up1.document?.mimeType})`);
  const doc1 = up1.document.id;
  up1.document.title === "身份证" ? ok("中文标题自动规整（符合 RULE 3）") : bad("标题未规整: " + up1.document.title);

  console.log("== 7. 未二次验证查看敏感文件应 403 ==");
  r = await call("a", "GET", `/api/documents/${doc1}/file`);
  status(r) === 403 ? ok("未验证访问 403") : bad("返回 " + status(r));

  console.log("== 8. 二次验证后查看应 200 且为合法无损文件流 ==");
  r = await call("a", "POST", "/api/auth/sensitive-verify", { json: { password: "ValidPass2026!" } });
  status(r) === 200 ? ok("二次验证通过") : bad("验证返回 " + status(r));
  r = await call("a", "GET", `/api/documents/${doc1}/file`);
  status(r) === 200 ? ok("解密查看 200") : bad("查看返回 " + status(r));
  const buf = Buffer.from(await r.arrayBuffer());
  (buf[0] === 0xff && buf[1] === 0xd8) || (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP")
    ? ok("解密后是合法图像流（无损存储与解密生效）")
    : bad("非合法图像流: " + buf.subarray(0, 4).toString("hex"));

  console.log("== 9. 错误密码二次验证应 401 ==");
  r = await call("a", "POST", "/api/auth/sensitive-verify", { json: { password: "nope1234" } });
  status(r) === 401 ? ok("错误密码 401") : bad("返回 " + status(r));

  console.log("== 10. 上传证书 + 结构化记录 ==");
  const fd2 = new FormData();
  fd2.append("file", new Blob([fs.readFileSync("test-cert.jpg")], { type: "image/jpeg" }), "cert.jpg");
  fd2.append("categoryId", certSub);
  fd2.append("title", "全国大学生数学建模竞赛一等奖");
  fd2.append("withCertificate", "true");
  fd2.append("certOrg", "中国工业与应用数学学会");
  fd2.append("certLevel", "国家级");
  fd2.append("certAwardedAt", "2025-11-15");
  r = await call("a", "POST", "/api/documents", { form: fd2 });
  const up2 = await r.json();
  status(r) === 201 ? ok("证书上传 201") : bad("证书上传 " + status(r) + JSON.stringify(up2));
  up2.document?.certificate ? ok("结构化证书记录已创建") : bad("无证书记录");

  console.log("== 11. 手动新增证书记录 ==");
  r = await call("a", "POST", "/api/certificates", {
    json: { name: "大学英语六级", org: "教育部考试中心", level: "国家级", awardedAt: "2025-06-20", note: "580分" },
  });
  status(r) === 201 ? ok("手动新增 201") : bad("返回 " + status(r));

  console.log("== 12. 证书筛选（国家级） ==");
  r = await call("a", "GET", "/api/certificates?level=" + encodeURIComponent("国家级"));
  const certs = (await r.json()).certificates;
  certs.length === 2 ? ok("筛出 2 条国家级") : bad("筛出 " + certs.length + " 条");

  console.log("== 13. 编辑文档标题 ==");
  r = await call("a", "PATCH", `/api/documents/${doc1}`, { json: { title: "身份证-国徽面" } });
  status(r) === 200 ? ok("编辑 200") : bad("返回 " + status(r));

  console.log("== 14. 打包导出 zip ==");
  r = await call("a", "POST", "/api/export", {
    json: { categoryKeys: ["identity", "certificate", "experience"], includeCertificates: true },
  });
  status(r) === 200 ? ok("导出 200") : bad("导出返回 " + status(r) + await r.text());
  const zip = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(".e2e/export.zip", zip);
  zip.subarray(0, 2).toString() === "PK" ? ok("输出为合法 zip") : bad("非 zip");
  console.log("    zip 大小:", zip.length, "bytes");

  console.log("== 15. 未登录访问 API 应 401 ==");
  r = await call("anon", "GET", "/api/documents");
  status(r) === 401 ? ok("未登录 401") : bad("返回 " + status(r));

  console.log("== 16. 越权访问他人文档 ==");
  await call("b", "POST", "/api/auth/register", {
    json: { account: "13800138000", password: "ValidPass2026B!", nickname: "同学B" },
  });
  r = await call("b", "GET", `/api/documents/${doc1}/file`);
  status(r) === 404 ? ok("越权访问被拒（404 不暴露存在性）") : bad("返回 " + status(r));

  console.log("== 17. 修改密码后旧会话失效 ==");
  r = await call("a", "PUT", "/api/account", { json: { oldPassword: "ValidPass2026!", newPassword: "ValidPass2026New!" } });
  status(r) === 200 ? ok("改密 200") : bad("返回 " + status(r));
  r = await call("a", "POST", "/api/auth/sensitive-verify", { json: { password: "ValidPass2026New!" } });
  status(r) === 401 ? ok("改密后旧会话已吊销") : bad("旧会话仍有效");
  r = await call("a", "POST", "/api/auth/login", { json: { account: "test@stu.edu.cn", password: "ValidPass2026New!" } });
  status(r) === 200 ? ok("新密码登录成功") : bad("返回 " + status(r));

  console.log("== 18. 账户注销（删除全部数据） ==");
  const userA = await prisma.user.findUnique({ where: { email: "test@stu.edu.cn" } });
  r = await call("a", "DELETE", "/api/account", { json: { password: "ValidPass2026New!", confirm: "注销" } });
  status(r) === 200 ? ok("注销 200") : bad("返回 " + status(r));
  const userA2 = await prisma.user.findUnique({ where: { email: "test@stu.edu.cn" } });
  const docCount = await prisma.document.count({ where: { userId: userA.id } });
  userA2 === null && docCount === 0 ? ok("用户与文档记录已彻底删除") : bad("仍有残留 user=" + !!userA2 + " docs=" + docCount);
  fs.existsSync("storage/" + userA.id) === false ? ok("物理文件目录已删除") : bad("storage 目录残留");

  console.log("\n================================");
  console.log(`通过 ${pass} 项 / 失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
