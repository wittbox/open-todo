import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { generateNKeysBetween } from "fractional-indexing";
import { hashPassword } from "../lib/auth/password";
import { DEV_SEED_PASSWORD } from "../lib/auth/dev";

/**
 * 개발용 데모 데이터. 가상의 팀(그룹·목록·작업)과, 공유·권한을 확인할 사용자 셋을 만든다.
 * 사람·회사 이름은 모두 지어낸 것이다.
 *
 *   npm run db:seed
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/** n개의 연속된 fractional index */
function keys(n: number): string[] {
  return generateNKeysBetween(null, null, n);
}

/** 오늘(서울 기준) 로부터 n일 뒤의 날짜 전용 값 — lib/date.ts 규칙과 동일 */
function day(offset: number): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset));
}

const GROUPS: { name: string; lists: { name: string; theme: string; tasks: TaskSeed[] }[] }[] = [
  {
    name: "앱 개발",
    lists: [
      {
        name: "백로그",
        theme: "blue",
        tasks: [
          { title: "로그인 화면 다듬기", steps: ["문구 확정", "버튼 정렬"], done: true, doneOffset: -2 },
          { title: "알림 설정 페이지", steps: ["설계 확정"], done: true, doneOffset: -3 },
        ],
      },
      { name: "QA", theme: "green", tasks: [] },
      {
        name: "이번 스프린트",
        theme: "purple",
        tasks: [
          { title: "검색 필터", steps: ["조건 정리", "결과 화면 연결"] },
          { title: "공유 링크 주소 확인" },
          { title: "배포 버튼 위치 정리" },
          { title: "수정: 날짜를 고를 수 있게", important: true },
          { title: "목록 정렬 옵션 추가", due: 3 },
        ],
      },
    ],
  },
  {
    name: "신제품 출시",
    lists: [
      {
        name: "파트너 미팅",
        theme: "purple",
        tasks: [
          { title: "소개 자료 전달", steps: ["최신 자료 찾아 전달"], note: "담당자 확인 후 회신", myDay: true },
          { title: "파트너 미팅", steps: ["회의록 정리"], stepsDone: 1, due: -2, important: true, myDay: true },
          { title: "경비 정산", done: true, doneOffset: -1 },
        ],
      },
    ],
  },
  {
    name: "마케팅",
    lists: [
      {
        name: "캠페인",
        theme: "red",
        tasks: [{ title: "랜딩 페이지 A/B 테스트", steps: ["지표 정의", "디자인 확인"], due: 3 }],
      },
    ],
  },
  {
    name: "해외 진출",
    lists: [
      {
        name: "현지 파트너",
        theme: "teal",
        tasks: [
          { title: "메일 회신 2건", steps: ["1차 회신", "2차 회신"], due: 2 },
          { title: "경비 보고서 작성", done: true, doneOffset: -4, important: true },
        ],
      },
    ],
  },
  {
    name: "운영",
    lists: [
      { name: "문서 정리", theme: "blue", tasks: [] },
      { name: "월간 점검", theme: "purple", tasks: [{ title: "월간 회의 일정 공지", due: 9 }] },
    ],
  },
];

type TaskSeed = {
  title: string;
  steps?: string[];
  stepsDone?: number;
  note?: string;
  important?: boolean;
  done?: boolean;
  doneOffset?: number;
  due?: number;
  myDay?: boolean;
};

async function main() {
  // 모든 표를 비우고, 모두가 아는 비밀번호로 사용자를 만든다 — 운영 DB 에서 돌면 사고다.
  if (process.env.NODE_ENV === "production") throw new Error("시드는 개발 DB 에서만 돌린다(NODE_ENV=production).");

  console.log("기존 시드 데이터 정리...");
  // MyDayEntry 는 User 와 Task 양쪽에서 cascade 대상이라 한 번에 지우면 경로가 겹친다.
  // 의존 순서대로 직접 지워 확실하게 정리한다.
  await prisma.myDayEntry.deleteMany();
  await prisma.step.deleteMany();
  await prisma.task.deleteMany();
  await prisma.reportSend.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.shareInvite.deleteMany();
  await prisma.share.deleteMany();
  await prisma.list.deleteMany();
  await prisma.group.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.user.deleteMany();

  console.log("사용자 생성...");
  // 확인된 이메일로 만든다. 홍길동이 관리자 — 첫 관리자 만들기는 이미 끝난 설치로 둔다.
  // 셋 다 비밀번호는 DEV_SEED_PASSWORD(로그인 화면에 안내가 뜬다, next dev 에서만).
  const verified = new Date();
  const passwordHash = await hashPassword(DEV_SEED_PASSWORD);
  const base = { emailVerifiedAt: verified, passwordHash, lastLoginAt: verified };
  const owner = await prisma.user.create({
    data: { email: "hong@example.com", name: "홍길동", avatarColor: "#c2185b", role: "ADMIN", ...base },
  });
  const teammate = await prisma.user.create({
    data: { email: "chulsoo@example.com", name: "김철수", avatarColor: "#2564cf", ...base },
  });
  const viewer = await prisma.user.create({
    data: { email: "younghee@example.com", name: "이영희", avatarColor: "#a4373a", ...base },
  });
  await prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: { setupCompletedAt: verified },
    update: { setupCompletedAt: verified },
  });

  // 사용자마다 기본 목록("작업") 1개
  for (const u of [owner, teammate, viewer]) {
    await prisma.list.create({
      data: { ownerId: u.id, name: "작업", themeKey: "purple", order: "a0", isInbox: true },
    });
  }

  console.log("그룹 / 목록 / 작업 생성...");
  const groupKeys = keys(GROUPS.length);

  for (const [gi, g] of GROUPS.entries()) {
    const group = await prisma.group.create({
      data: { ownerId: owner.id, name: g.name, order: groupKeys[gi] },
    });

    const listKeys = keys(g.lists.length);
    for (const [li, l] of g.lists.entries()) {
      const list = await prisma.list.create({
        data: {
          ownerId: owner.id,
          groupId: group.id,
          name: l.name,
          themeKey: l.theme,
          order: listKeys[li],
        },
      });

      const taskKeys = keys(Math.max(l.tasks.length, 1));
      for (const [ti, t] of l.tasks.entries()) {
        const task = await prisma.task.create({
          data: {
            listId: list.id,
            creatorId: owner.id,
            title: t.title,
            note: t.note ?? null,
            isImportant: t.important ?? false,
            isCompleted: t.done ?? false,
            completedAt: t.done ? day(t.doneOffset ?? -1) : null,
            dueDate: t.due === undefined ? null : day(t.due),
            order: taskKeys[ti],
          },
        });

        // 나의 하루는 사용자별이라 별도 행으로 만든다.
        if (t.myDay) {
          await prisma.myDayEntry.create({ data: { userId: owner.id, taskId: task.id, date: day(0) } });
        }

        if (t.steps?.length) {
          const stepKeys = keys(t.steps.length);
          await prisma.step.createMany({
            data: t.steps.map((title, si) => ({
              taskId: task.id,
              title,
              isCompleted: t.done === true || si < (t.stepsDone ?? 0),
              order: stepKeys[si],
            })),
          });
        }
      }
    }
  }

  console.log("공유 설정...");
  const launch = await prisma.group.findFirstOrThrow({
    where: { ownerId: owner.id, name: "신제품 출시" },
  });
  const campaign = await prisma.list.findFirstOrThrow({
    where: { ownerId: owner.id, name: "캠페인" },
  });

  // 그룹 = 편집 권한, 별도 목록 = 읽기 권한
  await prisma.share.create({
    data: {
      subjectType: "GROUP",
      subjectId: launch.id,
      granteeUserId: teammate.id,
      role: "EDITOR",
      invitedById: owner.id,
    },
  });
  await prisma.share.create({
    data: {
      subjectType: "LIST",
      subjectId: campaign.id,
      granteeUserId: viewer.id,
      role: "VIEWER",
      invitedById: owner.id,
    },
  });

  console.log("주간보고서 생성 및 공유...");
  // 이영희가 "공유받은 보고서"를 열람하는 시나리오를 재현하려면
  // 발행된 보고서가 하나 있어야 한다. 공유는 발행본에만 걸린다.
  const weekStart = (() => {
    const today = day(0);
    const dow = (today.getUTCDay() + 6) % 7; // 월=0
    return new Date(today.getTime() - dow * 86_400_000);
  })();
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const report = await prisma.weeklyReport.create({
    data: {
      authorId: owner.id,
      weekStart,
      title: `주간보고 (${iso(weekStart).slice(5)}~${iso(weekEnd).slice(5)})`,
      summary: "파트너 소개 자료 전달 완료. 다음 주 캠페인 일정 확정 예정.",
      scopeJson: { groupIds: [], excludedTaskIds: [], comments: {} },
      publishedAt: new Date(),
      contentJson: {
        weekStart: iso(weekStart),
        weekEnd: iso(weekEnd),
        rangeLabel: `${iso(weekStart)} ~ ${iso(weekEnd)}`,
        title: `주간보고 (${iso(weekStart).slice(5)}~${iso(weekEnd).slice(5)})`,
        summary: "파트너 소개 자료 전달 완료. 다음 주 캠페인 일정 확정 예정.",
        taskCount: 2,
        sections: [
          {
            key: "done",
            label: "이번 주 완료",
            groups: [
              {
                path: "앱 개발 › 백로그",
                tasks: [
                  {
                    id: "seed-1", seq: 0, title: "로그인 화면 다듬기", listId: "seed",
                    path: "앱 개발 › 백로그", stepDone: 2, stepTotal: 2,
                    dueDate: null, dueLabel: null,
                    steps: ["문구 확정", "버튼 정렬"], comment: null,
                  },
                ],
              },
            ],
          },
          {
            key: "inProgress",
            label: "진행 중",
            groups: [
              {
                path: "신제품 출시 › 파트너 미팅",
                tasks: [
                  {
                    id: "seed-2", seq: 0, title: "소개 자료 전달", listId: "seed",
                    path: "신제품 출시 › 파트너 미팅", stepDone: 0, stepTotal: 1,
                    dueDate: null, dueLabel: null,
                    steps: ["최신 자료 찾아 전달"], comment: "담당자 회신 대기",
                  },
                ],
              },
            ],
          },
          { key: "upcoming", label: "다음 주 예정", groups: [] },
        ],
      },
    },
    select: { id: true },
  });

  await prisma.share.create({
    data: {
      subjectType: "REPORT",
      subjectId: report.id,
      granteeUserId: viewer.id,
      role: "VIEWER",
      invitedById: owner.id,
    },
  });

  const counts = {
    사용자: await prisma.user.count(),
    그룹: await prisma.group.count(),
    목록: await prisma.list.count(),
    작업: await prisma.task.count(),
    세부단계: await prisma.step.count(),
    공유: await prisma.share.count(),
    보고서: await prisma.weeklyReport.count(),
  };
  console.log("완료:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
