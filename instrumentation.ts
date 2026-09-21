/**
 * 서버가 켜질 때 한 번 — 설치가 위험하거나 반쪽인 상태로 떠 있으면 로그로 알린다.
 * (Next 의 instrumentation 파일 규칙. 요청을 처리하지 않는다.)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await checkInstall();
  await checkAdmin();
}

async function checkInstall() {
  const [{ installProblems }, crypto, { smtpConfig }] = await Promise.all([
    import("@/lib/startup"),
    import("node:crypto"),
    import("@/lib/mail/smtp"),
  ]);

  let mailConfigured = process.env.MOCK_MAIL === "1";
  try {
    mailConfigured ||= smtpConfig() != null;
  } catch (e) {
    // SMTP 설정이 있는데 값이 틀린 경우(MAIL_FROM 이 주소가 아님 등). 그대로 알린다.
    console.error(`[setup] ${e instanceof Error ? e.message : e}`);
  }

  const problems = installProblems(process.env, {
    hasArgon2: typeof (crypto as { argon2?: unknown }).argon2 === "function",
    mailConfigured,
  });

  for (const p of problems) {
    const line = `[setup] ${p.message}`;
    if (p.level === "error") console.error(line);
    else console.warn(line);
  }
}

async function checkAdmin() {
  try {
    const { firstAdminWindowOpen, bootstrapEmail } = await import("@/lib/auth/instance");
    if (!(await firstAdminWindowOpen())) return;
    const only = bootstrapEmail();
    console.warn(
      only
        ? `[setup] No administrator yet. Whoever signs up as ${only} becomes the administrator.`
        : "[setup] No administrator yet. The first person to sign up becomes the administrator — on a server reachable from the internet, create that account now or set ADMIN_BOOTSTRAP_EMAIL.",
    );
  } catch {
    // DB 가 아직 준비되지 않았을 수 있다(마이그레이션 전). 알림일 뿐이라 넘어간다.
  }
}
