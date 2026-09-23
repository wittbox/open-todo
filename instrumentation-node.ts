/**
 * 서버가 켜질 때 한 번 — 설치가 위험하거나 반쪽인 상태로 떠 있으면 로그로 알린다.
 * Node 런타임에서만 불린다(instrumentation.ts). 여기서는 node: 모듈과 DB 를 마음껏 쓴다.
 */
export async function runStartupChecks() {
  await checkInstall();
  await checkAdmin();
  await startJobs();
}

/**
 * 예약 작업(알림·아침 요약·예약 발송)을 이 프로세스 안에서 돈다.
 * 한 컨테이너 안에 DB 와 앱이 같이 있는 설치(도커 이미지)가 `RUN_JOBS=1` 을 켠다.
 * 밖의 스케줄러를 쓰는 설치는 켜지 않고 `/api/cron/*` 를 `CRON_KEY` 로 두드리면 된다.
 */
async function startJobs() {
  if (process.env.RUN_JOBS !== "1") return;
  const { startJobScheduler } = await import("@/lib/jobs/scheduler");
  startJobScheduler();
  console.log("[jobs] scheduler on — reminders and the morning digest hourly, scheduled report mail every 5 minutes");
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
