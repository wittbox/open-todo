import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 메시지 첨부 (DB + 디스크).
 *
 * 파일은 글과 함께 multipart 로 온다. 비멤버는 404(없는 것과 같다), 보관은 403, 막힌 확장자·개수 초과는 400.
 * 붙은 파일은 멤버만 받을 수 있고 외부인에게는 404. 글을 지우면 행과 디스크 파일이 함께 사라진다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let currentUser = "";
vi.mock("@/lib/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...orig,
    requireUserId: async () => {
      if (!currentUser) throw new orig.UnauthenticatedError();
      return currentUser;
    },
    getSessionUserId: async () => currentUser || null,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const as = (id: string) => {
  currentUser = id;
};

let f: ProjectFixture;
let dir = "";

const route = await import("@/app/api/projects/[id]/messages/route");
const download = await import("@/app/api/files/[id]/route");
const msg = await import("@/lib/actions/message");
const { uploadDir } = await import("@/lib/files/storage");

function post(projectId: string, body: string, files: { name: string; content: string; type?: string }[], parentId?: string) {
  const fd = new FormData();
  fd.set("body", body);
  if (parentId) fd.set("parentId", parentId);
  for (const x of files) fd.append("files", new File([x.content], x.name, { type: x.type ?? "text/plain" }), x.name);
  const req = new NextRequest(`http://x/api/projects/${projectId}/messages`, { method: "POST", body: fd });
  return route.POST(req, { params: Promise.resolve({ id: projectId }) });
}

const fetchFile = (id: string) => download.GET(new Request(`http://x/api/files/${id}`), { params: Promise.resolve({ id }) });

d("메시지 첨부 (DB)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "todo-msgfiles-"));
    process.env.UPLOAD_DIR = dir;
    f = await createProjectFixture("mfile");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
    delete process.env.UPLOAD_DIR;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("비멤버 404, 보관 403, 막힌 확장자·개수 초과 400", async () => {
    as(f.stranger.id);
    expect((await post(f.priv.id, "안녕", [])).status).toBe(404);
    as(f.member.id);
    expect((await post(f.archived.id, "안녕", [])).status).toBe(403);
    expect((await post(f.priv.id, "실행", [{ name: "x.exe", content: "MZ" }])).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, content: "a" }));
    expect((await post(f.priv.id, "많다", eleven)).status).toBe(400);
    expect((await post(f.priv.id, "   ", [])).status).toBe(400);
  });

  it("파일이 있으면 본문이 비어도 되고, 붙은 파일은 멤버만 받는다", async () => {
    as(f.member.id);
    const res = await post(f.priv.id, "", [{ name: "패킹리스트.txt", content: "box 1" }, { name: "사진.png", content: "png", type: "image/png" }]);
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { id: string; files: { id: string; name: string; mimeType: string }[] } };
    expect(message.files.map((x) => x.name)).toEqual(["패킹리스트.txt", "사진.png"]);
    expect(uploadDir()).toBe(dir);

    const fileId = message.files[0].id;
    as(f.owner.id);
    const ok = await fetchFile(fileId);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("box 1");
    expect(ok.headers.get("Content-Disposition")).toContain("attachment");
    as(f.stranger.id);
    expect((await fetchFile(fileId)).status).toBe(404);
    as("");
    expect((await fetchFile(fileId)).status).toBe(401);

    // 지우면 행도 디스크 파일도 사라진다
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: fileId }, select: { storageKey: true } });
    const path = join(dir, row.storageKey.slice(0, 2), row.storageKey);
    expect((await stat(path)).size).toBe(5);
    as(f.member.id);
    expect((await msg.deleteMessage(message.id)).ok).toBe(true);
    expect(await prisma.attachment.count({ where: { messageId: message.id } })).toBe(0);
    await expect(stat(path)).rejects.toThrow();
  });

  it("답글에도 파일이 붙는다 — 원글의 프로젝트를 따른다", async () => {
    as(f.owner.id);
    const root = await msg.postMessage(f.priv.id, "원글");
    if (!root.ok) throw new Error(root.error);
    as(f.member.id);
    const res = await post(f.pub.id, "답", [{ name: "a.txt", content: "a" }], root.data.id);
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { parentId: string | null } };
    expect(message.parentId).toBe(root.data.id);
    const saved = await prisma.message.findFirst({ where: { parentId: root.data.id }, select: { projectId: true } });
    expect(saved?.projectId).toBe(f.priv.id);
  });
});
