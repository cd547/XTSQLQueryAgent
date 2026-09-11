// 临时测试：A+C 方案 findSimilarTablesBatch / getTableSchema similar_tables
import { getTableSchema } from "../src/services/toolFuncs.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// 1. 大小写不同：Windows NTFS 大小写不敏感 → 直接读到文件（成功）；
//    Linux 区分大小写 → error + similar_tables 归一化命中。两种行为都算通过。
const r1 = await getTableSchema(["ADMIN_USER_CHANNEL"]);
const r1DirectOk = !r1.error && !!r1.fields;
const r1SimilarOk = r1.error && r1.similar_tables?.[0]?.name === "admin_user_channel";
check("1 大写变体: 直接成功或 similar_tables 命中", r1DirectOk || r1SimilarOk, JSON.stringify(r1).slice(0, 200));

// 2. 漏下划线 → 归一化命中
const r2 = await getTableSchema(["adminuserchannel"]);
check("2 漏下划线: 命中 admin_user_channel", r2.similar_tables?.[0]?.name === "admin_user_channel", JSON.stringify(r2.similar_tables));

// 3. 多打字符 → 子串命中（查询词含表名）
const r3 = await getTableSchema(["admin_user_channelxx"]);
check("3 多打字符: 命中 admin_user_channel", (r3.similar_tables || []).some(t => t.name === "admin_user_channel"), JSON.stringify(r3.similar_tables));

// 4. 正常表 → 无 error 无 similar_tables
const r4 = await getTableSchema(["edu_student"]);
check("4 正常表: 无 error", !r4.error);
check("4 正常表: 有 fields", !!r4.fields);
check("4 正常表: 无 similar_tables", r4.similar_tables === undefined);

// 5. 乱写 → 无命中时不加字段
const r5 = await getTableSchema(["xyzzy_plugh"]);
check("5 乱写: error 存在", !!r5.error);
check("5 乱写: 无 similar_tables 字段", r5.similar_tables === undefined, JSON.stringify(r5.similar_tables));

// 6. 多表混合：一个存在一个不存在（漏下划线）
const r6 = await getTableSchema(["edu_student", "adminuserchannel"]);
check("6 混合: edu_student 正常", !r6.edu_student?.error);
check("6 混合: adminuserchannel 带 similar_tables", r6.adminuserchannel?.similar_tables?.length > 0, JSON.stringify(r6.adminuserchannel));
check("6 混合: 多表返回结构", !r6.fields && !!r6.edu_student);

// 7. 重复/大小写不同的两个查询不串结果
const r7 = await getTableSchema(["ADMINUSERCHANNEL", "zzzznotexist"]);
check("7 重复变体: 第一个命中", r7.ADMINUSERCHANNEL?.similar_tables?.length > 0, JSON.stringify(r7.ADMINUSERCHANNEL));
check("7 重复变体: 第二个无命中", r7.zzzznotexist?.similar_tables === undefined, JSON.stringify(r7.zzzznotexist));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
