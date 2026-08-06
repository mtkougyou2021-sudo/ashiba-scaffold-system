/** 初期データ投入: 承認者(代表者)ユーザーとシステム設定 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";
import { ensureDefaultSettings } from "../src/services/settingsService";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = process.env.ADMIN_NAME || "代表者";

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    if (!email || !password) {
      console.error("ユーザーが存在しません。ADMIN_EMAIL と ADMIN_PASSWORD を設定して再実行してください。");
      process.exit(1);
    }
    await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), name, role: "approver" },
    });
    console.log(`承認者ユーザーを作成しました: ${email}`);
  } else {
    console.log("ユーザーは既に存在します(スキップ)");
  }

  await ensureDefaultSettings();
  console.log("初期設定を確認しました");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
