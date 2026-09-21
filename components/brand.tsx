"use client";

import { createContext, useContext } from "react";
import { DEFAULT_APP_NAME } from "@/lib/brand";

/**
 * 화면에서 쓰는 설치 이름.
 *
 * 이름은 DB 에 있으므로 서버에서 한 번 읽어(`app/layout.tsx`) 브라우저로 내려 준다.
 * 환경 변수를 `NEXT_PUBLIC_` 으로 심지 않는 이유: 그러면 빌드할 때 박히고, 이미지를 받아
 * 쓰는 설치는 이름을 바꾸려고 다시 빌드해야 한다.
 */
const BrandContext = createContext(DEFAULT_APP_NAME);

export function BrandProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <BrandContext value={name}>{children}</BrandContext>;
}

export function useAppName(): string {
  return useContext(BrandContext);
}
