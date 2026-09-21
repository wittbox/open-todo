import { cleanAppName, DEFAULT_APP_NAME, envAppName } from "@/lib/brand";
import { getInstanceSettings } from "@/lib/auth/instance";

/**
 * 서버에서 쓰는 설치 이름. 관리자가 적은 이름 → `APP_NAME` → 기본 이름.
 *
 * 한 줄짜리 행을 읽는 가벼운 질의라 요청마다 한 번 더 도는 것을 감수한다 — 캐시를 두면
 * 관리자가 이름을 바꿔도 프로세스가 살아 있는 동안 옛 이름이 메일에 남는다.
 */
export async function appName(): Promise<string> {
  try {
    const settings = await getInstanceSettings();
    return cleanAppName(settings.appName) ?? envAppName() ?? DEFAULT_APP_NAME;
  } catch {
    // DB 가 아직 없을 수 있다(마이그레이션 전 첫 기동). 이름 때문에 화면이 죽지 않게 한다.
    return envAppName() ?? DEFAULT_APP_NAME;
  }
}

/** 브라우저 탭에 쓰는 "화면 이름 · 설치 이름". */
export async function pageTitle(title: string): Promise<string> {
  return `${title} · ${await appName()}`;
}
