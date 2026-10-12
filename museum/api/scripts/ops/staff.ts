// 팀원 계정·역할 CLI(T018·T159, D24 ③, BR-ACC-05, 보완 S5). 비밀번호는 표준 입력으로만 받는다(인자·로그에 남기지 않음).
//   npm run ops:staff -- add     --email <메일> --role operator[,evaluator,integrator]   (비밀번호 표준 입력)
//   npm run ops:staff -- grant   --email <메일> --role <역할>
//   npm run ops:staff -- revoke  --email <메일> --role <역할>
//   npm run ops:staff -- disable --email <메일>        # 정지 + 그 팀원 세션 삭제
//   npm run ops:staff -- enable  --email <메일>
//   npm run ops:staff -- passwd  --email <메일>        # 새 비밀번호 표준 입력 + 세션 삭제
//   npm run ops:staff -- list                          # 가린 이메일·역할·정지 여부
import { loadConfig } from '../../src/config.js';
import { createPool } from '../../src/db/pool.js';
import { StaffAdminError, addStaff, disableStaff, enableStaff, grantRole, listStaff, revokeRole, setStaffPassword } from '../../src/auth/staffAdmin.js';

const USAGE = '사용법: ops:staff add|grant|revoke|disable|enable|passwd|list [--email <메일>] [--role <역할>[,…]]  (비밀번호는 표준 입력)';
const [cmd, ...argv] = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const readStdin = () => new Promise<string>((res) => { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => res(s.trim())); });

async function main(): Promise<number> {
  const email = arg('email');
  const roles = (arg('role') ?? '').split(',').filter(Boolean);
  const needEmail = cmd !== 'list';
  if (!cmd || (needEmail && !email) || (['add', 'grant', 'revoke'].includes(cmd) && !roles.length)) { console.error(USAGE); return 2; }
  const db = createPool(loadConfig().db);
  try {
    switch (cmd) {
      case 'add': console.log(`팀원 ${await addStaff(db, email!, roles, await readStdin())} 등록(역할 ${roles.join(',')})`); break;
      case 'grant': await grantRole(db, email!, roles[0]); console.log(`역할 부여: ${roles[0]}`); break;
      case 'revoke': await revokeRole(db, email!, roles[0]); console.log(`역할 회수: ${roles[0]} — 다음 요청부터 반영`); break;
      case 'disable': await disableStaff(db, email!); console.log('정지하고 세션을 모두 지웠다'); break;
      case 'enable': await enableStaff(db, email!); console.log('정지 해제'); break;
      case 'passwd': await setStaffPassword(db, email!, await readStdin()); console.log('비밀번호를 바꾸고 세션을 모두 지웠다'); break;
      case 'list': for (const s of await listStaff(db)) console.log(`${s.memberId}\t${s.emailMasked}\t${s.roles.join(',') || '(역할 없음)'}\t${s.disabled ? '정지' : '사용'}`); break;
      default: console.error(USAGE); return 2;
    }
    return 0;
  } catch (e) {
    if (e instanceof StaffAdminError) { console.error(`거절: ${e.message}`); return 2; }
    throw e;
  } finally {
    await db.end();
  }
}

main().then((c) => process.exit(c));
