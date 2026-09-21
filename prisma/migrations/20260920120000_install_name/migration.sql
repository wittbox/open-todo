-- 설치 이름. 관리자가 /admin 에서 고친다. 비어 있으면 APP_NAME 환경 변수, 그다음 기본 이름을 쓴다.
ALTER TABLE "InstanceSettings" ADD COLUMN "appName" TEXT;
