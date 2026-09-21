/**
 * 서버가 켜질 때 한 번(Next 의 instrumentation 파일 규칙. 요청을 처리하지 않는다).
 *
 * register() 는 Node·Edge 두 런타임에서 모두 불린다. 이 조건은 빌드 때 런타임마다 값이 박혀
 * Edge 번들에서는 아래 import 가 통째로 빠진다 — 조건을 뒤집어 일찍 return 하는 모양으로 쓰면
 * 빠지지 않고, Edge 번들이 node: 모듈과 Prisma 를 끌어들인다는 경고가 난다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("./instrumentation-node");
    await runStartupChecks();
  }
}
