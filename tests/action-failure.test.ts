import { describe, expect, it } from "vitest";
import { ActionError, run } from "@/lib/actions/_helpers";
import { loginRedirect, loginUrl, runAction } from "@/lib/actions/session-guard";
import { PermissionError } from "@/lib/permissions";
import { UnauthenticatedError } from "@/lib/session";

/**
 * 액션 실패의 사유 코드.
 *
 * 인증·권한 실패는 서버 로그를 남기지 않는다(시끄러워지니까). 그래서 화면이 문구를
 * 눈으로 읽어 판단하는 대신 코드로 구분해야 한다. 이 구분이 없던 동안, 세션이 끊긴
 * 화면에서 드래그가 조용히 되돌아가는 것을 사람들은 "기능 고장"으로 신고했다.
 */

describe("실패 사유 코드", () => {
  it("로그인이 끊기면 unauthenticated", async () => {
    const res = await run(async () => {
      throw new UnauthenticatedError();
    });
    expect(res).toEqual({
      ok: false,
      error: "로그인이 필요합니다.",
      code: "unauthenticated",
      errorKey: "errors.unauthenticated",
    });
  });

  it("권한이 없으면 forbidden", async () => {
    const res = await run(async () => {
      throw new PermissionError();
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe("forbidden");
  });

  it("나머지는 unknown 이고 원인은 화면에 흘리지 않는다", async () => {
    const res = await run(async () => {
      throw new Error("DB 커넥션이 죽었다");
    });
    expect(res.ok === false && res.code).toBe("unknown");
    expect(res.ok === false && res.error).toBe("처리 중 오류가 발생했습니다.");
  });

  it("번역 키로 만든 거절은 요청한 사람의 언어로 바뀌고 키도 함께 간다. 문구로 만든 것은 그대로", async () => {
    const keyed = await run(async () => {
      throw ActionError.key("errors.forbidden");
    });
    expect(keyed).toEqual({
      ok: false,
      error: "해당 항목을 찾을 수 없거나 접근 권한이 없습니다.",
      code: "unknown",
      errorKey: "errors.forbidden",
    });
    const plain = await run(async () => {
      throw new ActionError("소유자는 먼저 소유권을 넘겨야 합니다.");
    });
    expect(plain).toEqual({ ok: false, error: "소유자는 먼저 소유권을 넘겨야 합니다.", code: "unknown" });
  });

  it("따로 적은 권한 거절 사유는 그대로 둔다", async () => {
    const res = await run(async () => {
      throw new PermissionError("보관된 프로젝트는 읽기 전용입니다.");
    });
    expect(res).toEqual({ ok: false, error: "보관된 프로젝트는 읽기 전용입니다.", code: "forbidden" });
  });

  it("성공은 그대로 값을 싣는다", async () => {
    expect(await run(async () => 42)).toEqual({ ok: true, data: 42 });
  });
});

describe("로그인으로 돌려보내기", () => {
  const here = "/list/abc?task=t1";

  it("인증이 끊긴 응답이면 원래 자리를 들고 로그인으로", () => {
    expect(loginRedirect({ ok: false, error: "x", code: "unauthenticated" }, here)).toBe(
      "/login?returnTo=%2Flist%2Fabc%3Ftask%3Dt1",
    );
  });

  it("권한 오류는 화면에 남는다 — 로그인해도 달라지지 않는다", () => {
    expect(loginRedirect({ ok: false, error: "x", code: "forbidden" }, here)).toBeNull();
    expect(loginRedirect({ ok: false, error: "x", code: "unknown" }, here)).toBeNull();
  });

  it("성공은 당연히 아무 데도 안 보낸다", () => {
    expect(loginRedirect({ ok: true, data: null }, here)).toBeNull();
  });

  it("돌아갈 자리가 수상하면 기본 화면으로", () => {
    // returnTo 는 로그인 뒤 그대로 이동하는 값이라, 남의 호스트를 넣을 수 있으면 안 된다.
    for (const bad of ["//evil.example.com", "https://evil.example.com", String.raw`/\evil.example.com`]) {
      expect(loginRedirect({ ok: false, error: "x", code: "unauthenticated" }, bad)).toBe(
        "/login?returnTo=%2Fcalendar",
      );
    }
  });
});

/**
 * 호출 자체가 깨지는 경로.
 *
 * 쿠키가 만료되면 액션은 돌지도 못한다 — 관문이 POST 를 /login 으로 돌려보내고 Next 는
 * "An unexpected response was received from the server" 를 던진다. 그 예외는 오류 경계가
 * 삼켜서 화면에 아무 흔적도 남지 않는다. 실제 신고가 이 경로였다.
 */
describe("액션 호출이 깨졌을 때", () => {
  const here = () => "/list/abc";

  it("세션이 끊긴 것이면 로그인으로 보낸다", async () => {
    const went: string[] = [];
    const res = await runAction(
      async () => {
        throw new Error("An unexpected response was received from the server.");
      },
      { probe: async () => true, go: (u) => went.push(u), here },
    );
    expect(went).toEqual(["/login?returnTo=%2Flist%2Fabc"]);
    expect(res.ok === false && res.code).toBe("unauthenticated");
  });

  it("세션이 멀쩡하면 보내지 않는다 — 네트워크가 잠깐 흔들린 것일 수 있다", async () => {
    const went: string[] = [];
    const res = await runAction(
      async () => {
        throw new Error("network hiccup");
      },
      { probe: async () => false, go: (u) => went.push(u), here },
    );
    expect(went).toEqual([]);
    expect(res.ok === false && res.code).toBe("unknown");
  });

  it("액션이 돌아서 인증 오류를 돌려준 경우에도 보낸다", async () => {
    const went: string[] = [];
    await runAction(
      async () => ({ ok: false as const, error: "로그인이 필요합니다.", code: "unauthenticated" as const }),
      { probe: async () => true, go: (u) => went.push(u), here },
    );
    expect(went).toEqual(["/login?returnTo=%2Flist%2Fabc"]);
  });

  it("성공은 그대로 통과시킨다", async () => {
    const went: string[] = [];
    const res = await runAction(async () => ({ ok: true as const, data: 7 }), {
      probe: async () => true,
      go: (u) => went.push(u),
      here,
    });
    expect(res).toEqual({ ok: true, data: 7 });
    expect(went).toEqual([]);
  });

  it("권한 오류는 화면에 남긴다", async () => {
    const went: string[] = [];
    const res = await runAction(
      async () => ({ ok: false as const, error: "권한이 없습니다.", code: "forbidden" as const }),
      { probe: async () => true, go: (u) => went.push(u), here },
    );
    expect(went).toEqual([]);
    expect(res.ok === false && res.error).toBe("권한이 없습니다.");
  });

  it("돌아갈 자리는 앱 안 경로만", () => {
    expect(loginUrl("//evil.example.com")).toBe("/login?returnTo=%2Fcalendar");
  });
});
