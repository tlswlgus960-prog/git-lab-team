// 요청 맥락(계약 머리말 "요청 번호", 점검표 L1): 요청 처리 중에 비동기로 찍는 로그 줄(메일 발송 등)도 같은 requestId를 갖게 한다.
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
