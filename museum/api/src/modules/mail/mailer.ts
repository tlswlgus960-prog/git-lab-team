// 메일 발송(T045, research R-23): nodemailer → P0 Mailpit. 커밋 뒤 비동기로 보내고, 실패는 응답을 바꾸지 않는다(가입 여부 비노출).
// 메일에는 가족 정보(별칭·작품)를 넣지 않는다(FR-32). 로그에는 메일 종류·결과만(수신 주소·토큰·링크 금지, BR-PRV-01).
import nodemailer from 'nodemailer';
import { log } from '../../lib/logger.js';

export type MailKind = 'verify' | 'already_registered' | 'recovery' | 'invite';
export interface MailMessage { kind: MailKind; to: string; link?: string }
export interface Mailer { send(msg: MailMessage): void }

const SUBJECT: Record<MailKind, string> = {
  verify: '[우리 아이 미술관] 이메일을 확인해 주세요',
  already_registered: '[우리 아이 미술관] 이미 가입돼 있어요',
  recovery: '[우리 아이 미술관] 로그인 정보 찾기',
  invite: '[우리 아이 미술관] 공동 보호자 초대',
};

function body(m: MailMessage): string {
  switch (m.kind) {
    case 'verify': return `아래 링크를 눌러 가입을 마쳐 주세요(24시간 안에 한 번만 쓸 수 있어요).\n${m.link}\n`;
    case 'already_registered': return `이 이메일은 이미 가입돼 있어요. 로그인하거나 로그인 정보 찾기를 이용해 주세요.\n`;
    case 'recovery': return `로그인 아이디는 이 메일을 받은 주소(${m.to})예요.\n비밀번호를 바꾸려면 아래 링크를 눌러 주세요(30분 안에 한 번만 쓸 수 있어요).\n${m.link}\n`;
    case 'invite': return `가족 공간의 공동 보호자로 초대받았어요. 아래 링크로 수락해 주세요(7일 안에 한 번만 쓸 수 있어요).\n${m.link}\n`;
  }
}

export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const t = nodemailer.createTransport(smtpUrl);
  return {
    send(m) {
      t.sendMail({ from, to: m.to, subject: SUBJECT[m.kind], text: body(m) })
        .then(() => log.info({ event: 'mail_sent', code: m.kind }))
        .catch(() => log.warn({ event: 'mail_failed', code: m.kind }));
    },
  };
}

/** 발송 끔(MAIL_ENABLED=false, R-23 갱신 2 · D36): 보내지 않고 종류만 로그에 남긴다 — 수신 주소·링크는 남기지 않는다. */
export function disabledMailer(): Mailer {
  return { send: (m) => log.info({ event: 'mail_disabled', code: m.kind }) };
}

/** 시험용 — 보낸 메일을 모은다. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { sent, send: (m) => { sent.push(m); } };
}
