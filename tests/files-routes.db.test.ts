import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 첨부 올리기·내려받기.
 *
 * 파일을 정적 폴더로 열지 않은 이유가 여기 다 있다 — 주소를 알아도 그 목록을
 * 볼 수 없으면 받을 수 없어야 한다. 그리고 남이 올린 자료를 편집 권한만으로
 * 지울 수 있으면, 공유 목록에서 누군가의 근거가 조용히 사라진다.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

let currentUser: string | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSessionUserId: async () => currentUser,
    requireUserId: async () => {
      if (!currentUser) throw new actual.UnauthenticatedError();
      return currentUser;
    },
  };
});

const { POST: uploadFile } = await import("@/app/api/tasks/[taskId]/files/route");
const { GET: downloadFile } = await import("@/app/api/files/[id]/route");
const { deleteAttachment } = await import("@/lib/actions/task");
const { prisma } = await import("@/lib/db");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: Fixture;
let tmpDir: string;

beforeAll(async () => {
  if (!hasDb) return;
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tmpDir = await mkdtemp(join(tmpdir(), "todo-files-"));
  process.env.UPLOAD_DIR = tmpDir;
  f = await createFixture("files");
});

afterAll(async () => {
  if (!hasDb) return;
  await destroyFixture(f);
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

function upload(taskId: string, name: string, body: string, type = "text/plain") {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  return uploadFile(
    new NextRequest(`https://todo.example.com/api/tasks/${taskId}/files`, { method: "POST", body: form }),
    { params: Promise.resolve({ taskId }) } as never,
  );
}

const download = (id: string) =>
  downloadFile(new Request(`https://todo.example.com/api/files/${id}`), {
    params: Promise.resolve({ id }),
  } as never);

d("올리기", () => {
  it("로그인 없이는 올릴 수 없다", async () => {
    currentUser = null;
    expect((await upload(f.task.id, "a.txt", "hi")).status).toBe(401);
  });

  it("읽기 권한만으로는 올릴 수 없다", async () => {
    currentUser = f.viewer.id;
    expect((await upload(f.task.id, "a.txt", "hi")).status).toBe(403);
  });

  it("권한 밖 작업은 있는지도 알려주지 않는다", async () => {
    currentUser = f.stranger.id;
    expect((await upload(f.task.id, "a.txt", "hi")).status).toBe(404);
  });

  it("편집 권한이 있으면 올라간다", async () => {
    currentUser = f.editor.id;
    const res = await upload(f.task.id, "보고서.txt", "내용");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.file.name).toBe("보고서.txt");
    expect(body.file.size).toBeGreaterThan(0);
  });

  it("실행 파일은 거부한다", async () => {
    currentUser = f.editor.id;
    const res = await upload(f.task.id, "setup.exe", "MZ");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("실행 파일");
  });

  it("빈 파일은 거부한다", async () => {
    currentUser = f.editor.id;
    expect((await upload(f.task.id, "empty.txt", "")).status).toBe(400);
  });
});

d("내려받기", () => {
  let fileId: string;

  it("올린 파일을 그대로 돌려준다", async () => {
    currentUser = f.editor.id;
    const body = await (await upload(f.task.id, "자료.txt", "본문입니다")).json();
    fileId = body.file.id;

    const res = await download(fileId);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("본문입니다");
  });

  it("텍스트는 펼치지 않고 받게 한다", async () => {
    const res = await download(fileId);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("그림은 펼쳐 보여 준다", async () => {
    currentUser = f.editor.id;
    const body = await (await upload(f.task.id, "사진.png", "PNGDATA", "image/png")).json();
    const res = await download(body.file.id);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
  });

  it("SVG 는 그림이어도 받게 한다 — 스크립트를 품을 수 있다", async () => {
    currentUser = f.editor.id;
    const body = await (await upload(f.task.id, "도형.svg", "<svg/>", "image/svg+xml")).json();
    const res = await download(body.file.id);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("목록을 볼 수 있으면 받는다 — 읽기 권한이면 충분하다", async () => {
    currentUser = f.viewer.id;
    expect((await download(fileId)).status).toBe(200);
  });

  it("주소를 알아도 권한이 없으면 못 받는다", async () => {
    currentUser = f.stranger.id;
    expect((await download(fileId)).status).toBe(404);

    currentUser = null;
    expect((await download(fileId)).status).toBe(401);
  });

  it("없는 파일과 권한 없는 파일을 구분하지 않는다", async () => {
    currentUser = f.stranger.id;
    const missing = await download("does-not-exist");
    const forbidden = await download(fileId);
    expect(missing.status).toBe(forbidden.status);
  });
});

d("지우기", () => {
  it("올린 본인은 지울 수 있다", async () => {
    currentUser = f.editor.id;
    const body = await (await upload(f.task.id, "내가올린.txt", "x")).json();

    expect(await deleteAttachment(body.file.id)).toEqual({ ok: true });
    expect(await prisma.attachment.count({ where: { id: body.file.id } })).toBe(0);
  });

  it("남이 올린 것은 편집 권한만으로 지우지 못한다", async () => {
    currentUser = f.owner.id;
    const body = await (await upload(f.task.id, "소유자가올린.txt", "x")).json();

    currentUser = f.editor.id; // 그룹 공유 EDITOR
    const res = await deleteAttachment(body.file.id);
    expect(res.ok).toBe(false);
    expect(await prisma.attachment.count({ where: { id: body.file.id } })).toBe(1);
  });

  it("목록 관리자는 지울 수 있다", async () => {
    currentUser = f.editor.id;
    const body = await (await upload(f.task.id, "편집자가올린.txt", "x")).json();

    currentUser = f.owner.id; // 소유자 = ADMIN
    expect(await deleteAttachment(body.file.id)).toEqual({ ok: true });
  });

  it("권한 밖 사람은 지우지 못한다", async () => {
    currentUser = f.owner.id;
    const body = await (await upload(f.task.id, "지켜야할.txt", "x")).json();

    currentUser = f.stranger.id;
    expect((await deleteAttachment(body.file.id)).ok).toBe(false);
  });
});
