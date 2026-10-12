// 아이 미술관(CSS 3D) 화면 문구(D40, SD_02 §17-13 B · C · F). 해요체 · 개발 용어 없음.
// ko.ts와 같은 규칙: '점수' · '확률' · '%' · '실패했' · '!'를 쓰지 않는다(museum3d.spec이 검사).
export const m3 = {
  title: (alias: string) => `${alias}의 미술관`,
  scene: (alias: string) => `${alias}의 미술관 — 1인칭 장면`,
  plaque: (alias: string) => `${alias}의 미술관`,
  untitled: '제목 없는 그림',
  artButton: (title: string) => `${title} — 가까이 가기`,

  // 방 이름 — 방문자는 번호만(§17-13 F)
  ageRoom: (age: number) => `${age}살 전시실`,
  noAgeRoom: '나이 미정 전시실',
  ageAutoRoom: '나이를 적지 않은 작품',
  autoTitle: '제목이 아직 없는 작품',
  visitRoom: (n: number) => `전시실 ${n}`,
  mergedAges: (from: number, to: number) => `${from}~${to}살 전시실`,
  mergedMore: (label: string) => `${label} 외`,
  emptyRoom: '다음 전시실',
  lobby: '로비',
  hall: '가운데 홀', // 팀장 요구(2026-09-30): 방 버튼 줄과 같은 이름 — 설계서 §17-13 B는 "중앙 홀"
  roomCount: (label: string, n: number) => `${label} · ${n}점`,

  pedestalEmpty: '입체로 만들면 여기에 놓여요',
  plinthEmpty: '여기에 만들기 작품이 놓여요',
  nearOpen: '눌러서 크게 보기',

  exit: '밖으로',
  exitLabel: '밖으로 — 미술관 앞 광장으로',
  map: '안내도 크게 보기',
  mapTitle: '미술관 안내도',
  mapRooms: '전시실로 가기',
  mapNote: '점을 누르면 그 작품 앞으로 걸어가요. 전시실 이름을 눌러도 돼요.',
  mapHere: '지금 여기',
  roomBar: '전시실 바로 가기',
  mapTap: '안내도를 눌러 그곳으로 걸어가기',
  close: '닫기',

  // 안내는 누르기만(D52 B) — 끌기 · 키보드는 덤
  keys: ['그림을 누르면 가까이 가요', '다음 작품 ▶으로 차례로 봐요'],
  touchKeys: '끌어서 둘러보고, 바닥을 두 번 눌러 걸어가요',

  loading: '미술관 문을 여는 중이에요',
  empty: '아직 걸린 그림이 없어요. 그림을 올리면 여기에 걸려요.',
  emptyVisit: '아직 걸린 그림이 없어요',
  visitLocked: '친구가 되면 들어갈 수 있어요',
  visitBadge: '친구의 미술관',
  retry: '다시 열기',
  toTown: '마을로 가기',

  play: '움직여 보기',
  stop: '멈추기',

  // 견본 미술관(D48, SD_02 §17-17)
  sampleAlias: '견본이',
  sampleBanner: '견본 미술관이에요 — 우리 아이 그림으로 만들어 볼까요?',
  sampleStart: '카카오로 시작하기',
  sampleExitLabel: '밖으로 — 미술관 앞 광장으로',
  sampleNote: '견본 그림은 우리 팀이 그렸어요',

  // D52 B · C: 앞 · 다음 작품, 첫 안내, 외관 · 친구
  prev: '앞 작품',
  next: '다음 작품',
  restart: '처음으로',
  tourLabel: '작품 차례로 보기',
  coachTitle: '미술관 둘러보는 법',
  coachSteps: ['그림을 누르면 가까이 가요', '[다음 작품 ▶]으로 차례로 봐요', '끌면 둘러볼 수 있어요'],
  coachStep: (n: number, total: number) => `${total}개 중 ${n}번째 안내`,
  coachNext: '다음',
  coachOk: '알겠어요',
  invite: '친구 초대',
  town: '미술관 마을',
  toTownShort: '마을로',
  enter: '들어가기',
  outsideRegion: (alias: string) => `${alias}의 미술관 — 바깥 광장`,
  outsideSub: '문을 열고 들어가 볼까요?',
} as const;
