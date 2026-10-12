// 캐릭터 만들기 화면 문구(D40, SD_02 §17-13 A). 해요체 · 개발 용어 없음.
// ko.ts와 같은 규칙: '점수' · '확률' · '%' · '실패했' · '!'를 쓰지 않는다(copy.spec 기준, 여기서는 character.spec이 검사).
import { josa } from '@/copy/josa';

export const cc = {
  title: '캐릭터 만들기',
  editTitle: '캐릭터·건물 바꾸기',
  steps: ['이름 짓기', '캐릭터 고르기', '미술관 모양 고르기', '개관'] as const,
  stepNav: '만들기 단계',
  stepOf: (n: number, total: number, name: string) => `${total}단계 중 ${n}단계 · ${name}`,
  goStep: (n: number, name: string) => `${n}단계 ${josa(name, '으로/로')} 가기`,
  next: '다음',
  back: '이전',

  askName: '이 친구를 뭐라고 부를까요?',
  nameTag: '이름표',
  nameHint: '실명 대신 가족이 부르는 이름을 적어 주세요',
  remaining: (n: number) => `남은 글자 ${n}/20`,
  notCollected: '실명 · 생년월일 · 출생연도는 받지 않아요',
  nameFirst: '이름을 먼저 적어 주세요',
  nameTooLong: '이름은 20자까지예요',

  pickTitle: '어떤 친구와 함께할까요?',
  friends: '동물 친구',
  colors: '색',
  avatarLabel: (color: string, kind: string) => `${color}색 ${kind}`,

  styleTitle: '어떤 미술관을 지을까요?',
  prevStyle: '이전 모양',
  nextStyle: '다음 모양',
  styleCount: (i: number, n: number) => `${n}가지 중 ${i}번째`,
  townLabel: (name: string) => `작은 마을 위의 ${name}`,

  openTitle: '개관식',
  ribbonHint: '리본을 자르면 미술관 문이 열려요',
  cutRibbon: '리본 자르기',
  saving: '문을 여는 중이에요',
  opened: (alias: string) => `${alias}의 미술관이 문을 열었어요`,
  enter: '미술관에 들어가기',
  toFriend: '친구 초대 이어서 받기', // 친구 링크로 가입했을 때 개관 뒤(§17-16)
  dup: (alias: string) => `같은 이름 ${josa(alias, '이/가')} 이미 있어요. 저장은 됐고, 아이는 따로 구분해요`,

  saveEdit: '바꾼 대로 저장하기',
  loading: '불러오는 중이에요',
  notFound: '이 아이를 찾을 수 없어요',
  toChildren: '우리 아이로 돌아가기',

  buildingLabel: (name: string, locked: boolean) => (locked ? `${name}, 문이 잠겨 있어요` : name),
  lockedHint: '친구가 되면 들어갈 수 있어요', // D52: 화면 말은 "친구"
};
