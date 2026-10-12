// 화면 문구 사전(T035, U10, R-20). 정본은 docs/C/C_화면문구.md — 문구를 바꿀 때는 그 문서 → SD_02 → 이 파일 순서로 고친다(D22 ⑦).
// [추론] 표시 문구는 문서와 같은 검토 대상이다.
import { josa } from './josa';

/** 차단 블록 변형(SD_02 C2 · §17). */
export type BlockVariant = 'block' | 'hold' | 'final';

/** 오류 사유 → 차단 블록 문구(docs/C/C_화면문구.md §3). */
export interface ProblemCopy {
  variant: BlockVariant;
  /** 블록 제목 옆 요약 */
  summary: string;
  /** 사유 */
  reason: string;
  /** 해제 주체 */
  releaser: string;
  /** 해제 주체가 지금 사용자면 true — 해제 버튼을 준다(§16 규칙 ③) */
  self: boolean;
  /** 다음 행동(버튼 라벨 또는 안내) */
  actions: string[];
}

const SELF = '보호자 - 지금 이 화면';

/** 나이 표시 — null이면 "나이 미정"(D34 ③, SD_02 §17-9) */
const AGE = (age: number | null) => (age == null ? '나이 미정' : `${age}살`);

export const ko = {
  state: {
    received: '접수됨',
    judging: '살펴보는 중',
    awaiting_confirm: '확정 대기',
    processing: '처리 중',
    processing_queued: '처리 중 - 순서를 기다리는 중',
    retrying: '다시 시도 중',
    awaiting_review: '확인 대기',
    approved: '확인했어요',
    exhibited: '전시 중',
    not_delivered: '처리하지 못함',
    deleting: '삭제 중',
  },
  /** 보호자에게 보이는 3단계(D34 ④, SD_02 §17-8) — 내부 상태 이름 대신. 운영 화면은 state 그대로 */
  guardian: {
    steps: { upload: '올리는 중', frame: '액자에 담는 중', hung: '걸었어요' } as Record<string, string>,
    chip: { received: '올리는 중', judging: '액자에 담는 중', processing: '액자에 담는 중', approved: '액자에 담는 중', awaiting_confirm: '골라 주세요',
      awaiting_review: '확인해 주세요', exhibited: '걸었어요', failed: '담지 못했어요', not_delivered: '담지 못했어요', deleting: '지우고 있어요' } as Record<string, string>, // [추론]
    done: '됐어요', notYet: '아직이에요', // [추론]
  },
  stage: {
    queued: '대기',
    running: '진행 중',
    done: '완료',
    retry_wait: '다시 시도 중',
    failed: '처리하지 못함',
    cancelled: '취소',
  },
  rail: {
    leaveOk: '화면을 닫아도 계속돼요',
    showBlock: '막힌 자리 보기',
  },
  model: {
    ready: '준비됨',
    not_loaded: '미준비',
    loading: '불러오는 중',
    loadingSlow: '예상보다 오래 걸려요',
    failed: '적재 실패 · 60초마다 다시 시도해요',
    cold: '내려감 짐작 · 첫 요청 때 올라가요',
    inactive_license: '비활성 · 라이선스 확인 전',
    inactive_promote: '비활성 · 승격 전', // [추론] 활성 버전 없음(no_active_version)
    inactive_tier: '비활성 · P0.5 예정',
    cpu: 'CPU 실행',
    hidden: '비노출 · P1',
    unknown: '확인 불가',
  },
  wait: {
    model: '그림을 볼 준비를 하고 있어요. 조금만 기다려 주세요',
    modelEta: (s: number) => `약 ${s}초`,
  },
  fail: {
    file: '지금은 불러올 수 없어요',
    fileRetry: '다시 불러오기',
    opsStale: (at: string) => `갱신 불가 · 마지막 확인 ${at}`,
    draftRestored: '저장하지 못한 입력이 있어요',
    draftFill: '채워 넣기',
    draftDiscard: '버리기',
    generic: '잠시 뒤 다시 해 주세요', // [추론]
  },
  block: {
    blockTitle: '막힘',
    holdTitle: '기다리는 중',
    finalTitle: '되돌릴 수 없어요',
    reasonLabel: '사유',
    releaserLabel: '해제 주체',
    actionsLabel: '다음 행동',
    disabled: '(비활성)',
  },
  auth: {
    loginTitle: '로그인',
    opsLoginTitle: '팀원 로그인',
    email: '이메일',
    password: '비밀번호',
    passwordConfirm: '비밀번호 확인',
    login: '로그인',
    logout: '로그아웃',
    signup: '가입하기',
    forgot: '로그인 정보를 잊었어요',
    emailIsId: '이메일이 로그인 아이디예요 - 따로 아이디를 만들지 않아요',
    notCollected: '이름 - 전화번호 - 아이 정보는 받지 않아요',
    checkMailbox: '메일함을 확인해 주세요',
    checkMailboxBody: '확인 링크를 보냈어요. 이미 가입한 주소라면 안내 메일이 가요',
    verified: '이제 아이를 등록해 주세요',
    resetDone: '이메일과 새 비밀번호로 로그인해 주세요',
    // S0·S0b 화면(T052·T053, docs/C/C_화면문구.md §4 S0 — 2026-09-29 추가)
    signupTitle: '이메일로 가입',
    signupLead: '이메일과 비밀번호만 받아요',
    mailboxHint: '메일이 없으면 스팸함을 보거나 잠시 뒤 다시 받아 주세요',
    resendVerify: '확인 메일 다시 받기',
    haveAccount: '이미 가입하셨나요? 로그인',
    needEmail: '이메일을 적어 주세요', // [추론]
    badEmail: '이메일 형식을 확인해 주세요', // [추론]
    needPassword: '비밀번호를 적어 주세요', // [추론]
    shortPassword: '비밀번호는 8자 이상이에요', // [추론 — U19 예시값]
    mismatch: '비밀번호 확인이 같지 않아요', // [추론]
    verifying: '메일을 확인하고 있어요', // [추론]
    recoveryTitle: '로그인 정보 찾기',
    recoveryEmail: '가입한 이메일',
    recoverySend: '메일 받기',
    recoveryIdHint: '로그인 아이디는 가입한 이메일이에요',
    recoverySent: '가입된 이메일이면 메일을 보냈어요',
    recoverySentBody: '메일의 링크로 비밀번호를 새로 정해 주세요',
    recoveryOnce: '링크는 한 번만 - 정해진 시간 안에만 쓸 수 있어요',
    recoveryAgain: '메일 다시 받기',
    toLogin: '로그인으로',
    resetTitle: '새 비밀번호 정하기', // [추론]
    newPassword: '새 비밀번호',
    newPasswordConfirm: '새 비밀번호 확인',
    save: '저장',
    // S0c 계정 - 비밀번호 변경(T161, UC14 A5, docs/C/C_화면문구.md §4 S0c)
    changePwTitle: '비밀번호 바꾸기', currentPassword: '현재 비밀번호', changePw: '바꾸기', needCurrent: '현재 비밀번호를 적어 주세요', // [추론]
    pwChanged: '비밀번호를 바꿨어요 - 다른 기기에서는 다시 로그인해야 해요', myAccount: '내 계정', // [추론]
  },
  /** 보호자 여정 레일(C1 여정 변형, SD_02 §2-3 · S0 와이어프레임). */
  journey: {
    signup: '가입', verify: '메일 확인', child: '아이 등록', upload: '작품 올리기',
    confirm: '확정', review: '결과 확인', story: '이야기', exhibit: '전시',
  },
  /** S1 아이 관리(T054, docs/C/C_화면문구.md §4 S1). */
  child: {
    title: '우리 아이',
    count: (n: number) => `우리 아이 ${n}명`,
    colAlias: '별칭', colArtworks: '작품 수', colActions: '조작',
    edit: '별칭 고치기', remove: '아이 삭제',
    addTitle: '아이 추가 - 별칭만 받아요',
    alias: '별칭',
    aliasHint: '실명 대신 가족이 부르는 별칭을 적어 주세요',
    remaining: (n: number) => `남은 글자 ${n}/20`,
    notCollected: '실명 - 생년월일 - 출생연도는 받지 않아요',
    save: '저장',
    toUpload: '작품 올리기로',
    needChild: '아이를 먼저 등록해 주세요',
    empty: '아직 등록한 아이가 없어요', // [추론]
    dupTitle: '같은 별칭',
    dup: (alias: string) => `같은 별칭 ${josa(alias, '이/가')} 이미 있어요. 그대로 둘까요, 고칠까요?`,
    dupSaved: '저장은 됐어요',
    dupWhy: '아이는 시스템이 따로 구분해요 - 이용자 중복은 이메일 계정으로 막아요',
    keep: '그대로 두기',
    cancel: '취소',
  },
  /** S2~S8 구현 문구(docs/C/C_화면문구.md §4 "S2~S8 구현 문구", 2026-09-29 이제민 — 신지현 위임). */
  kind: { animated: '움직이는 그림', relief: '입체 그림', frame: '원본 액자', sculpture: '입체 조각' } as Record<string, string>, // D34 ④(SD_02 §17-8)
  /** 낮춤 안내(C6)에 쓰는 결과 이름 — 앞 결과를 만들지 못해 뒤 결과로 바꿨다 */
  downgrade: {
    animated_to_relief: ['움직임', '입체 부조'], animated_to_frame: ['움직임', '원본 액자'], relief_to_frame: ['입체 부조', '원본 액자'],
    split_fail: ['입체 부조', '원본 액자'], sculpture_to_relief: ['3D 조각', '입체 부조'],
  } as Record<string, readonly [string, string]>,
  downgradeNote: (from: string, to: string) => `${josa(from, '을/를')} 만들지 못해 ${josa(to, '으로/로')} 바꿨어요. 원본 액자로 걸 수도 있어요`,
  stageName: {
    split: '분리', judge: '그림 살펴보기', animate_render: '움직임 만들기', depth_relief: '입체로 만들기', frame_compose: '액자', sculpture: '3D 조각', caption: '설명',
  } as Record<string, string>,
  stageStatus: { waiting: '대기', running: '진행 중', done: '완료', retrying: '다시 시도 중', failed: '처리하지 못함', cancelled: '취소' } as Record<string, string>,
  list: {
    colTitle: '작품', colChild: '아이', colState: '상태', colStage: '현재 단계',
    untitled: '제목 없음', // [추론]
    toConfirm: '고르러 가기', toReview: '결과 확인으로', toStory: '이야기 쓰기', toGallery: '전시 보기', // [추론] 이야기 쓰기·전시 보기
    empty: '아직 올린 작품이 없어요', // [추론]
    detailTitle: (t: string) => `${t} - 어디까지 왔을까요`,
    progress: '어디까지 왔을까요',
    colStep: '단계', colStepState: '상태', colNote: '안내',
    retried: (n: number) => `${n}번 다시 시도했어요`,
    backToList: '작품 목록',
  },
  notDelivered: {
    summary: '결과를 만들지 못했어요',
    reason: (what: string) => `잠깐 문제가 생겨 ${josa(what, '을/를')} 만들지 못했어요 - 낮춘 결과가 아니에요`,
    releaser: '보호자 - 원본 액자로 걸기 또는 다시 찍기',
  },
  upload: {
    whose: '누구의 작품인가요', child: '아이', photo: '사진',
    camera: '사진 찍기', album: '앨범에서 고르기', rule: 'JPEG - PNG - HEIC  한 장 20MB 이하',
    submit: '올리기',
    afterTitle: '올린 뒤', after1: '올리면 바로 액자에 담기 시작해요', after2: '기다리지 않고 화면을 닫아도 계속돼요',
    needChild: '아이를 골라 주세요', // [추론]
    needPhoto: '사진을 골라 주세요',
    tooBig: '더 작은 사진을 골라 주세요', // D34 ④ 숫자 없음
    sending: '올리는 중이에요', // [추론]
    // 작품 영역 자르기(D32, docs/C/C_화면문구.md §4 S2 작품 영역 — [추론])
    crop: {
      title: '작품 영역 (선택)', hint: '작품에 맞게 네모를 줄여 주세요. 네모 밖은 올라가지 않아요',
      keys: '화살표로 조절, Shift+화살표는 크게', reset: '사진 전체로',
      cropped: (w: number, h: number) => `잘라서 올려요 ${w.toLocaleString('ko-KR')} x ${h.toLocaleString('ko-KR')}`,
      whole: '사진 전체를 올려요',
      unreadable: '이 사진은 화면에서 열 수 없어 자르지 않고 그대로 올려요',
      failed: '사진을 자르지 못했어요. 사진 전체로 올리거나 다시 골라 주세요',
      cutting: '자르는 중이에요',
      handle: { nw: '왼쪽 위 모서리', n: '위', ne: '오른쪽 위 모서리', e: '오른쪽', se: '오른쪽 아래 모서리', s: '아래', sw: '왼쪽 아래 모서리', w: '왼쪽', move: '네모 옮기기' },
    },
  },
  confirm: {
    cutout: '그림 부분', originalFallback: '원본 사진 - 액자 권장',
    suggestionTitle: '제안', judging: '살펴보는 중', noSuggestion: '제안을 준비하지 못했어요 - 직접 골라 주세요',
    suggestion: { animated: '움직일 수 있을 것 같아요', relief: '입체 부조로 만들어 볼까요?', frame: '원본 액자로 걸어 볼까요?' } as Record<string, string>, // U10 [추론 — UC 문구]
    howTitle: '어떻게 걸까요', submit: '확정하기', pickOne: '하나를 골라 주세요', later: '나중에 고르기',
    started: '만들기 시작했어요',
    g7Reason: '작품을 살펴보는 곳에 잠깐 문제가 있었어요', g7Releaser: '보호자 - 셋 중 하나를 직접 고르기', g7Next: '아래에서 고르면 확정할 수 있어요',
  },
  review: {
    original: '원본', originalSub: '올린 그대로', result: (k: string) => `결과 - ${k}`,
    play: '재생', pause: '정지', showOriginal: '원본 보기', showResult: '결과 보기', // [추론]
    decision: { like: '좋아요', use_lower: '낮춘 결과로 걸기', frame: '액자로 걸기', retake: '다시 찍기' } as Record<string, string>,
    unavailable: { needs_result: '결과가 없어요', original_unreadable: '원본을 읽을 수 없어요', model_disabled: '지금은 이 방식을 쓸 수 없어요' } as Record<string, string>,
    retakeTitle: '다시 찍을까요?', // [추론]
    retakeBody: '지금 작품은 지워지고 새로 올려요', cancel: '취소',
    afterApprove: '이야기를 채우면 전시돼요', afterLower: '입체 부조를 새로 만들어요',
  },
  story: {
    ageLine: (n: number) => `${n}살 때`, // S6 명패(D46)
    required: '필수', title: '제목', madeOn: '그린 날', age: '그때 나이',
    words: '아이의 한마디 - 선택 - 적은 그대로 보여요',
    save: '저장', saved: '저장했어요', // [추론] 저장했어요
    exhibited: '전시에 걸렸어요',
    exhibitTitle: '전시 조건', condReview: '결과 확인', condStory: '제목 · 그린 날 · 나이', condNote: '두 가지가 갖춰지면 전시에 걸려요',
    fixDate: '그린 날을 고쳐 주세요', ageRange: '나이는 0살부터 18살까지예요', titleLong: '제목은 100자까지예요', // [추론] 나이·제목
    mine: '내가 적은 내용', // [추론]
    // D25 보호자 감상평(docs/C/C_화면문구.md 전시실 홈 절)
    note: '보호자 감상평 - 선택 - 적은 그대로 보여요', noteHint: '작품을 보고 느낀 점을 적어 주세요', noteLong: '감상평은 1000자까지예요', // [추론]
  },
  /** S7 설명 초안 받기(T129, P0.5, docs/C/C_화면문구.md §4 "S7 구현 문구", SD_02 §10). */
  caption: {
    title: '설명 초안 받기', notGate: '설명은 전시 조건이 아니에요', withExhibit: '전시될 때 함께 보여요',
    keywords: '키워드', keywordsHint: '쉼표로 나눠 5개까지, 한 개에 20자까지', tags: '태그 후보', // [추론] 힌트
    input: 'AI에 보낼 입력 - 사진과 아이 이름은 보내지 않아요',
    inKeywords: '키워드', inTags: '고른 태그', inWords: '한마디', inAge: '나이', inDate: '그린 날', none: '없음', // [추론] 없음
    warming: (n: number | null) => (n == null ? '처음 만들 때는 조금 더 걸릴 수 있어요' : `처음 만들 때는 조금 더 걸릴 수 있어요 (최대 약 ${n}초)`),
    busy: '다른 설명을 먼저 만들고 있어요',
    writing: (n: number) => `쓰는 중 - ${n}초`, // [추론]
    draft: '초안 - AI 작성', noDraft: '아직 초안이 없어요', ai: 'AI 작성', direct: '직접 씀', edited: '고침', // [추론] 직접 씀·고침
    g16: 'AI 초안이 입력에 없는 내용을 넣어 기본 문장으로 바꿨어요',
    make: '초안 만들기', remake: '다시 만들기', toDirect: '버리고 직접 쓰기', approve: '승인', saveEdit: '고친 내용 저장', // [추론] 고친 내용 저장
    directLabel: '작품 설명', save: '저장', cancel: '취소', // [추론]
    template: '기본 문장으로 받기', later: '나중에', writeDirect: '직접 쓰기',
    needDraft: '초안이 없어요', needKeywords: '키워드를 하나 이상 적거나 골라 주세요', writingNow: '쓰는 중이에요', needBody: '설명을 적어 주세요', // [추론] 뒤 둘
    approvedExhibited: '전시에 함께 보여요', locked: '승인한 설명이에요 - 더 고칠 수 없어요', // [추론]
  },
  gallery: {
    child: '아이', search: '제목 - 그린 날 찾기', age: (n: number) => `${n}살`,
    words: '아이의 한마디', aiCaption: '작품 설명 - AI 작성', backside: '뒷면은 AI가 추정했어요',
    empty: '아직 걸린 작품이 없어요', noMatch: '찾는 작품이 없어요', // [추론] noMatch
    toList: '목록으로', toUpload: '작품 올리기',
  },
  /** 전시실 홈(제안, SD_02 §17-2, docs/C/C_화면문구.md "전시실 홈 구현 문구" — 팀 확인 전). */
  museum: {
    name: '우리 아이 미술관', tagline: '작은 손이 그린 큰 이야기', enter: '입장하기', // [추론] tagline
    hall: (alias: string) => `${alias}의 미술관`, // [추론]
    child: '아이', plan: '전시실 안내', entrance: '입구', room: (n: number | null) => (n == null ? '나이 미정' : `${n}세관`), // [추론] 안내·입구
    plaque: (date: string, age: number | null) => `${date} · ${AGE(age)}`,
    emptyTitle: '첫 그림을 걸어 볼까요?', upload: '작품 올리기', // [추론]
    preparing: (n: number) => `전시 준비 중인 작품 ${n}점`, manage: '작품 관리', // [추론]
    kind: { animated: '움직이는 그림 - 누르면 움직여요', relief: '입체 부조', frame: '액자 작품', sculpture: '3D 조각' } as Record<string, string>, // [추론] 움직이는 그림·액자 작품
    play: '움직여 보기', stop: '멈추기', showOriginal: '원본 보기', showWork: '작품 보기', back: '전시실로', // [추론]
    childWords: '아이의 한마디', guardianNote: '보호자 감상평', commentary: '작품 해설 - AI 작성', menuHall: '미술관', // [추론] 미술관
    // 전시 해설(월 라벨, SD_02 §17-2 — 규칙 문장, AI 아님). 한마디는 원문 그대로 따옴표 안에(화면에서 끼운다)
    label: '전시 해설',
    // D46 ⑩: 보호자가 적지 않은(자동) 나이 · 해는 부르는 쪽이 null · ''로 넘긴다 — 모르는 사실을 단정하지 않는다
    artist: (alias: string, age: number | null, year: string) => { const p = [age == null ? '' : `${age}세 작`, year].filter(Boolean).join(', '); return p ? `${alias} (${p})` : alias; },
    // D46 ⑩: title은 자동 제목이면 null, year는 자동 날짜면 '' — 적은 것만 말한다. 날짜 · 나이가 없으면 "그린"도 쓰지 않는다
    intro: (title: string | null, alias: string, age: number | null, year: string, month: number, making = false) => {
      const head = title ? `「${title}」${josa(title, '은/는').slice(title.length)} ` : '';
      const verb = making ? '만든' : '그린';
      if (!year && age == null) return `${head}${alias}의 작품입니다.`;
      const when = year ? `${age == null ? '' : `${age}살이던 `}${year}년 ${month}월에` : `${age}살 때`;
      return `${head}${josa(alias, '이/가')} ${when} ${verb} 작품입니다.`;
    },
    wordsBefore: '작가는 이 그림을 두고 “', wordsAfter: '”라고 말했습니다.', // [추론]
    kindLine: { animated: '종이에 그린 그림이 움직이는 작품으로 걸렸습니다.', relief: '종이 그림이 입체 부조로 걸렸습니다.', sculpture: '종이 그림이 3D 조각으로 걸렸습니다.' } as Record<string, string>, // [추론]
    // 건축 평면도·로비(D25 ⑥)
    floorPlan: '평면도', lobby: '로비', corridor: '회랑', north: '북', // [추론]
    collection: (n: number) => `소장 작품 ${n}점`, latest: '최근에 걸린 작품', // [추론]
    hangOf: (age: number | null) => (age == null ? '나이를 적지 않은 작품' : `${age}살 때 그린 작품`), // [추론] 세관 벽(옆으로 넘기는 영역) 이름
    // 전시실 /app/hall · 입장(D26 ⑥, SD_02 §17-4)
    hallTitle: (alias: string) => `${alias}의 전시실`, toHome: '홈으로', // [추론]
    roomMeta: (n: number, from: string) => `${n}점 · ${from} ~`, // [추론]
    intro1: '아이가 그린 그림을 가족의 미술관에 걸어요', intro2: '올릴 때 한마디를 함께 남기고, 큐레이터가 해설을 붙여요', // [추론]
  },
  /** 홈 시안(D26, SD_02 §17-3 — 시안, docs/C/C_화면문구.md). */
  paper: {
    draft: '시안 - 아날로그 감성 홈 (검토용)', toCurrent: '지금 홈 보기', enterHall: '전시실로 들어가기', // [추론]
    statWorks: '소장 작품', unitWorks: '점', statRooms: '세관', unitRooms: '개', statFirst: '첫 그림', // [추론]
    firstOf: (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}`,
    reel: '걸린 작품', prev: '이전 작품', next: '다음 작품', pos: (i: number, n: number) => `${i} / ${n}`, // [추론]
    family: '가족 보호자', toFamily: '가족 보호자 보기', // [추론]
  },
  /** 고전 미술관 시안 A · B(D30, SD_02 §17-5 — 시안, docs/C/C_화면문구.md "고전 미술관 시안"). 두 시안 문구 같음. */
  classic: {
    room: (no: number, age: number | null) => `제${no}전시실 · ${AGE(age)}`, // [추론]
    roomNo: (no: number) => `제${no}전시실`, // [추론]
    roomLine: (age: number | null, n: number, from: string) => `${AGE(age)} · ${n}점 · ${from} ~`, // [추론]
    wallOf: (no: number) => `제${no}전시실 작품`, // [추론]
    plaqueOpen: (title: string) => `${title} - 크게 보기`, // [추론]
    map: '미술관 안내도', here: '현재 위치', cell: (age: number | null, n: number) => `${AGE(age)} · ${n}점`, // [추론]
  },
  /** 걸어 다니는 미술관(D31, SD_02 §17-6 — docs/C/C_화면문구.md "걸어 다니는 미술관"). */
  walk: {
    enter: '입장하기', skip: '건너뛰기', upload: '작품 올리기', list: '한눈에 보기', wall: '벽 색', // [추론] 벽 색
    forward: '앞으로', backward: '뒤로', toCorridor: '회랑으로', close: '닫기', toWalk: '걸어서 보기', // [추론]
    atGate: '입구', atCorridor: (i: number, n: number) => `회랑 ${i}/${n}`, atJunction: '갈림길', // [추론]
    room: (age: number | null) => (age == null ? '나이 미정 전시실' : `${age}살 전시실`), roomCount: (n: number) => `${n}점`, // [추론]
    toLeft: (age: number | null) => `← ${AGE(age)} 전시실`, toRight: (age: number | null) => `${AGE(age)} 전시실 →`, toOnly: (age: number | null) => `${AGE(age)} 전시실로 →`, // [추론]
    wallTitle: '벽 색 고르기', wallNames: { cream: '크림', pink: '분홍 구름', mint: '민트 하늘', lilac: '라일락', sky: '하늘', butter: '버터' } as Record<string, string>,
    wallCustom: '직접 고르기', wallReset: '처음 색으로', wallAdjusted: '글자가 잘 보이도록 조금 밝게 했어요', // [추론]
    listTitle: (alias: string) => `${alias}의 미술관 - 한눈에 보기`, // [추론]
    scene: '미술관 장면', // [추론] 장면 영역 이름
  },
  /** 1인칭 고전 회랑(D33, SD_02 §17-9 — docs/C/C_화면문구.md "1인칭 고전 회랑") */
  /** 사진 고치기(D39, SD_02 §17-12 · docs/C/C_화면문구.md) [추론] */
  fix: { open: '사진 고치기', title: '사진 고치기', hint: '네 모서리를 그림 끝에 맞춰 주세요. 원본 사진은 그대로 남아요.', preview: '액자에 걸릴 모습',
    left: '왼쪽으로 돌리기', right: '오른쪽으로 돌리기', reset: '원래대로', save: '저장', done: '사진을 고쳤어요', fail: '고치지 못했어요 — 다시 해 볼까요?',
    corner: ['왼쪽 위 모서리', '오른쪽 위 모서리', '오른쪽 아래 모서리', '왼쪽 아래 모서리'] },
  /** 올리기 전 자동 펴기 · 작품 이야기(D35 ①② · D46, SD_02 §17-14) [추론] */
  up2: { flatTitle: '그림 부분만 반듯하게 폈어요', fix: '모서리 고치기 · 돌리기', useWhole: '사진 전체 쓰기', storyTitle: '작품 설명 - 적지 않아도 돼요', more: '한마디 · 감상 더 적기',
    fixHint: '네 모서리를 그림 끝에 맞춰 주세요. 잘린 부분은 보내지 않아요.', fixUse: '이대로 쓰기', left: '왼쪽', right: '오른쪽', fixFail: '펴지 못했어요 - 다시 해 볼까요?',
    kindLegend: '어떤 작품인가요', drawing: '그림이에요', making: '만들기예요', title: '제목', titlePh: '비우면 "제목 없는 그림"', madeOn: '그린 날', age: '그때 나이',
    agePh: '비우면 지난 나이', words: '아이의 한마디', note: '부모 감상', lockNote: '미술관처럼, 걸린 작품은 바꾸지 않아요. 설명은 큐레이터가 해 드려요. 내리고 싶으면 작품을 지울 수 있어요.' },
  /** 가족 코멘트(D46 ④ · ⑨) [추론] */
  comment: { title: '가족 코멘트', ph: '코멘트를 남겨 주세요', send: '남기기', del: '지우기', empty: '아직 코멘트가 없어요', me: '나', owner: '보호자', co: '공동 보호자', gone: '보호자', fail: '코멘트를 남기지 못했어요 — 다시 해 볼까요?', delFail: '지우지 못했어요 — 다시 해 볼까요?', loadFail: '코멘트를 불러오지 못했어요', retry: '다시 불러오기' }, // D46 ⑨: 7일 기한은 내부 규칙 — 화면 안내 없음
  /** 저장하기(D37, SD_02 §17-10 · docs/C/C_화면문구.md) [추론] */
  /** 움직임 질문(D49, SD_02 §17-9) — 문구는 이제민 지시 그대로 */
  animAsk: { q: '애니메이션으로 만드시겠습니까?', yes: '예', no: '아니오', later: '나중에', hint: '만드는 동안 지금 액자는 그대로 걸려 있어요',
    judging: '그림을 살펴보는 중이에요', started: '만들기 시작했어요', startedHint: '다 되면 작품 목록에서 [좋아요]를 눌러 바꿔 걸어요', close: '닫기',
    remakeHint: '지금 액자는 그대로 걸려 있어요. 다 되면 [좋아요]를 눌러 바꿔 걸어요',
    remaking: (k: string) => `${josa(k, '을/를')} 만드는 중이에요`, remakeQueued: (k: string) => `${josa(k, '을/를')} 만들 차례를 기다리는 중이에요`, remakeRetry: (k: string) => `${josa(k, '을/를')} 다시 만들어 보는 중이에요`, fail: '지금은 만들 수 없어요 - 잠시 뒤 작품 화면에서 다시 해 볼까요?' },
  save: { framed: '액자 그림 저장', moving: '움직이는 그림 저장', busy: '저장하는 중…', done: '저장했어요', fail: '저장하지 못했어요 — 다시 해 볼까요?' },

  photo: {
    scene: '고전 회랑 - 1인칭 장면', intro: '고전 회랑에 우리 아이 그림이 걸렸어요', enter: '입장하기', // [추론]
    atGate: '고전 회랑 입구', atHall: '고전 회랑', room: (age: number | null) => `${AGE(age)} 전시실`, // [추론]
    banner: (age: number | null, n: number) => `${AGE(age)} 전시실 · ${n}점`, art: (title: string, age: number | null) => `${title}, ${AGE(age)} - 가까이 가기`, // [추론]
    near: (madeOn: string, age: number | null) => `${madeOn} · ${AGE(age)} · 눌러서 크게 보기`, // [추론]
    next: '다음 작품', prev: '이전 작품으로 걸어가기', skip: '건너뛰기', map: '안내도 크게 보기', mapTitle: '안내도 - 고전 회랑', // [추론]
    mapNote: '입구에서 안쪽으로 걸을수록 어릴 때 그림이에요. 작품 점을 누르면 그 앞으로 걸어가요', entrance: '입구', // [추론]
    credit: (author: string, license: string) => `사진: ${author}, ${license} (변형: 3D 면으로 펴서 자름)`, // 작업 지시 문구
    hangFraming: '액자에 담는 중', hangDone: '걸었어요', suggest: '걸었어요 · 이렇게도 만들어 볼까요?', // D34 ⑤ [추론]
    suggestAnimate: '움직이게', suggestRelief: '입체로', suggestNo: '괜찮아요', // D34 ⑤ [추론]
    titleAsk: '제목을 붙여 줄까요?', titleWrite: '제목 적기', // D34 ③ [추론]
    keys: 'W A S D 걷기 · 끌기 둘러보기 · Shift 빨리 · E 크게 보기 · Space 다음 작품', // [추론]
  },
  /** S1b~S1d 공동 보호자(docs/C/C_화면문구.md §4 "S1b~S1d 구현 문구", T107). */
  // 카카오 로그인·초대 링크(D36, SD_02 §17-7 — 이제민 요청서 §3 문구)
  kakao: {
    start: '카카오로 시작하기',
    preparing: '준비 중이에요',
    emailLogin: '이메일로 로그인(기존 회원)',
    cancelled: '로그인을 취소했어요. 다시 해 볼까요?',
    failed: '카카오 로그인이 되지 않았어요. 잠시 뒤 다시 해 볼까요?',
    welcome: '아이를 등록해 볼까요?',
    welcomeHint: '아이 별칭을 하나 정하면 그림을 올릴 수 있어요',
    unverified: '이 계정은 아직 사용할 수 없어요. 카카오로 시작하거나 운영자에게 물어봐 주세요',
    inviteTitle: '초대하기 - 링크를 보내요',
    inviteCopy: '초대 링크 복사하기',
    copied: '링크를 복사했어요. 카카오톡으로 보내 주세요',
    copyManual: '아래 링크를 길게 눌러 복사해 카카오톡으로 보내 주세요',
    linkInvite: '초대 링크',
    colInvite: '초대',
    inviteHint: '링크는 한 번만 쓸 수 있고 7일 뒤에 끝나요. 새 링크를 만들면 이전 링크는 쓸 수 없어요',
    invitedStart: '받은 초대로 들어가려면 카카오로 시작해 주세요',
    inviteError: { token_invalid: '이 초대 링크는 이미 쓰였거나 끝났어요. 초대한 보호자에게 새 링크를 받아 주세요', already_in_family: '이미 다른 가족 공간에 있어요. 그 가족에서 나온 뒤에 초대를 받을 수 있어요', co_guardian_full: '이 가족은 보호자가 이미 두 명이에요' } as Record<string, string>,
    joined: '가족 보호자가 되었어요',
    account: '카카오로 로그인',
  },
  family: {
    title: (n: number) => `우리 가족 보호자 ${n}명 - 두 명까지`,
    colMember: '보호자', colRole: '역할', colActions: '조작', role: { owner: '만든 보호자', co: '공동 보호자' } as Record<string, string>, me: '(나)',
    release: '해제', inviteTitle: '초대하기 - 이메일로 초대해요', inviteEmail: '초대할 이메일', // [추론] 초대할 이메일
    send: '초대 보내기', full: '보호자는 두 명까지예요', fullHint: '공동 보호자를 해제하면 다시 초대할 수 있어요',
    same: '공동 보호자는 아이 - 작품 - 이야기를 똑같이 관리해요', ownerOnly: '초대와 해제는 가족 공간을 만든 보호자만 할 수 있어요',
    sent: '초대 메일을 보냈어요',
    pending: (n: number) => `대기 중 초대 ${n}건`, pendingFull: '보호자가 두 명이라 보낼 수 있는 초대가 없어요',
    colInvite: '초대 이메일', colExpires: '만료', cancelInvite: '취소', // [추론] 만료
    releaseConfirm: '해제하면 이 가족 자료를 볼 수 없게 돼요. 올린 작품은 남아요',
    leave: '가족 공간에서 나가기', leaveConfirm: '나가면 이 가족 자료를 볼 수 없게 돼요. 올린 작품은 남아요', leaveGo: '나가기', // [추론] leaveConfirm
    cancel: '취소',
    // S1c
    invitedTitle: '가족 공간 초대를 받았어요', invited1: '수락하면 공동 보호자가 되어 아이 - 작품 - 이야기를 함께 관리해요',
    invited2: '만든 보호자와 권한이 같아요. 나중에 스스로 나갈 수 있어요', invited3: '초대 링크는 한 번만 - 7일 안에만 쓸 수 있어요',
    accept: '수락하기', toFamily: '지금 가족 공간으로', leaveFirst: '다른 가족 공간에서 나간 뒤 수락할 수 있어요',
    ownerCannotLeave: '만든 보호자는 가족 공간을 나갈 수 없어요 - 초대한 분께 다른 이메일로 다시 초대를 부탁해 주세요',
    joined: '가족 공간에 합류했어요', signupInvited: '초대받은 이메일로 가입하기', // [추론] 가입하기
    // S1d
    noFamilySummary: '속한 가족 공간이 없음', noFamilyReason: '가족 공간에서 나갔거나 해제되어 아이 - 작품 화면에 들어갈 수 없어요',
    noFamilyReleaser: '보호자 - 받은 초대를 수락하거나 새 가족 공간을 만들기', oldWorks: '예전 가족 공간에 올린 작품은 그 가족에 남아 있어요',
    waitTitle: '초대 기다리기', wait1: '다른 보호자에게 초대를 부탁하고 메일의 링크를 눌러 주세요', wait2: '가족 공간이 없는 동안에는 바로 수락할 수 있어요',
    create: '새 가족 공간 만들기', create1: '만들면 이 가족의 만든 보호자가 돼요', create2: '만든 보호자는 나갈 수 없어 다른 가족의 초대를 받을 수 없어요',
  },
  /** S9 삭제(docs/C/C_화면문구.md §4 "S9 구현 문구", T101). */
  del: {
    artwork: '작품 삭제', child: '아이 삭제',
    title: '아이를 지울까요? 되돌릴 수 없어요', artworkTitle: '이 작품을 지울까요?', // 외부 피드백 4차(SD_02 §17-14)
    artworkItems: ['사진과 만든 결과, 이야기가 모두 지워져요 · 되돌릴 수 없어요'],
    childItems: (alias: string, n: number) => `${josa(alias, '과/와')} 작품 ${n}개가 모두 지워져요`, // [추론]
    keeps: '통계용 숫자만 남고 누구의 작품인지는 남지 않아요',
    confirm: '지우기', cancel: '그만두기', deleted: '지웠어요',
    progress: { accepted: '접수했어요', waiting_stop: '만들던 작업이 멈추기를 기다리는 중이에요', deleting_files: '파일을 지우는 중이에요', done: '지웠어요' } as Record<string, string>,
    noWait: '기다리지 않아도 돼요', toList: '목록으로',
    locked: '삭제 중 - 이 작품의 모든 조작이 잠겼어요',
  },
  /** S12 API활용(docs/C/C_화면문구.md §4 "S12 구현 문구", T125). */
  apiGuide: {
    tabs: { endpoints: '엔드포인트', guideline: '가이드라인', manual: '매뉴얼' } as Record<string, string>,
    colGroup: '묶음', colPath: '경로', colTier: '구간', p0: 'P0', p05: 'P0.5 예정', internalKey: 'P0 팀 내부 키',
    versionOk: '문서 버전 - 명세 - 매니페스트 일치',
    versionBad: (m: string, a: string, b: string) => `${m} 명세 ${a} · 활성 ${b}`, // [추론]
    reload: 'openapi.json 다시 읽기', stale: (at: string) => `마지막 확인 명세 ${at}`, // [추론]
    testTitle: (f: string) => `시험 호출 - ${f}`, fn: '기능', input: '입력 - 평가 묶음 작품',
    call: '시험 호출', pickItem: '평가 묶음 작품을 골라 주세요', noItems: '평가 묶음 작품이 없어요', // [추론]
    colOutcome: '결과 분류', colModel: '모델 ID 버전', colTime: '처리 시간', colState: '상태',
    noFamily: '결과는 가족 저장소에 쓰지 않아요',
  },
  /** S10·S11 운영(docs/C/C_화면문구.md §4 "S10~S11 구현 문구", 2026-09-29 이제민). 비율은 소수 둘째 자리(퍼센트 기호 없음). */
  ops: {
    alive: '생존', aliveOk: '응답함', aliveNo: '응답 없음', // [추론] 응답 없음
    ready: '준비', readyAll: '준비됨', readySome: '일부 모델 미준비', readyNo: '준비 안 됨', // [추론] 준비됨·준비 안 됨
    period: '기간', periods: { d7: '최근 7일', d30: '최근 30일', all: '전체' } as Record<string, string>, // [추론] 30일·전체
    readyTitle: '준비 - 모델별', colModel: '모델', colGroup: '서빙군', colState: '상태', colImpact: '영향',
    group: { cpu_vision: 'CPU 비전', gpu: 'GPU', llm: 'LLM', external: '외부' } as Record<string, string>,
    shortName: { M1: 'M1 분리', M2: 'M2 판정', M3: 'M3 움직임', M5: 'M5 깊이', M6: 'M6 설명', M7: 'M7 3D' } as Record<string, string>,
    longName: { M4: 'M4 관절 기하 규칙', M1: 'M1 BiRefNet', M2: 'M2 OpenCLIP', M3: 'M3 Animated Drawings', M5: 'M5 Depth Anything', M6: 'M6 Qwen3-4B', M7: 'M7 TripoSR' } as Record<string, string>,
    impact: {
      M1: '잘라 내기 없이 원본으로', M2: '제안 없이 확정', M3: '움직임 - 액자 경로는 동작', M5: '입체 부조 - 액자 경로는 동작',
      M6: '설명 - 기본 문장·직접 쓰기', M7: '3D 비노출', cpu: '처리 시간 증가',
    } as Record<string, string>, // [추론] M1·M5·M6·M7
    metricsTitle: '지표 - 정의와 검증 계획이며 실적 아님',
    firstApproval: '첫 결과 승인율', modifyRate: '판정 수정률', unreached: '결과 미도달 수 - 목표 0', delIncomplete: '삭제 미완료 수',
    captionFail: '설명 규칙 검사 실패율 - P0.5', na: '해당 없음',
    tabs: { models: '모델별', causes: '원인 5분류', unreached: '결과 미도달 추적' } as Record<string, string>,
    colVersion: '버전', colAttempts: '시도', colDowngrade: '낮춤률', colP95: 'p95', colRetry: '재시도율',
    colWaiting: '대기', colOldest: '가장 오래 기다림', colFunction: '기능', colCalls: '호출', colRejected: '한도 초과', // [추론] 가장 오래 기다림
    causes: { guardianChoice: '보호자 선택', modelDowngrade: '모델 낮춤', guardianSwitch: '보호자 전환', infraFailure: '인프라 실패', unreached: '결과 미도달' } as Record<string, string>, // [추론] 보호자 전환
    colJob: '단계 작업 번호', colModelVersion: '모델 버전', colErrorClass: '오류 분류',
    errorClass: { engine_down: '엔진 다운', timeout: '시간 초과', storage: '저장소', db: 'DB', model_not_ready: '모델 미준비' } as Record<string, string>, // [추론] 엔진 다운 외
    noFamilyPath: '운영 화면에는 가족 사진과 이야기로 가는 경로가 없어요',
    // S11
    colActive: '활성', colRollback: '롤백 후보', colCandidate: '후보', colLicense: '라이선스', colHash: '해시',
    licenseOk: '확인', licenseNo: '확인 전', none: '없음',
    statusTitle: '모델 상태', colDevice: '장치', colLoad: '적재', colQueue: '대기', colAction: '동작',
    warmup: '지금 불러오기', lastLoad: (n: number) => `마지막 적재 ${n}초`,
    loading: (e: number, r: number | null) => (r != null ? `${e}초 - 남은 약 ${r}초` : `${e}초`),
    evalTitle: (m: string, v: string) => `${m} 후보 ${v} 평가`,
    evalProgress: (d: number, t: number, inc: number) => `진행 ${d} / ${t} 완료 - 평가 미완료 ${inc}`,
    evalNone: '평가 전이에요', // [추론]
    evalRequest: '평가 요청', report: '보고서 열기', judge: '판단 기록', verdict: { pass: '통과', hold: '보류' } as Record<string, string>, // [추론] 통과·보류
    rationale: '판단 근거', promote: '승격', rollback: '롤백', deactivate: '비활성화', reason: '사유', // [추론] 판단 근거·사유
    needRationale: '판단 근거를 적어 주세요', needReason: '사유를 적어 주세요', pickVerdict: '통과 또는 보류를 골라 주세요', // [추론]
    notEligible: '평가 미완료 또는 통과 판단 전이에요', // [추론]
    noRollback: '되돌릴 후보가 없어요',
    deactivateConfirm: '이 모델이 필요한 선택지가 보호자 화면에서 막혀요. 비활성화할까요?',
    readOnly: '읽기 전용이에요 - 조작은 평가 담당만', // [추론]
    // S11 모델 점검(T157, D20 — docs/C/C_화면문구.md "S11 모델 점검 구현 문구")
    colCheck: '마지막 점검', check: '점검', checking: '점검 중이에요', checkRunning: '점검 중', checkQueued: '점검 대기', checkNone: '점검 없음', // [추론] 대기·없음
    checkPassed: (sec: string, ago: string) => `통과 - ${sec}초 - ${ago}`, checkFailed: (why: string) => `실패 - ${why}`,
    ago: (min: number) => (min < 1 ? '방금' : min < 60 ? `${min}분 전` : `${Math.floor(min / 60)}시간 전`), // [추론] 방금·시간 전
    failReason: { engine_down: '엔진 다운', timeout: '시간 초과', storage: '저장소', db: 'DB', model_not_ready: '모델 미준비', bad_output: '출력 형식 불량' } as Record<string, string>,
    checkNotPromotion: '점검 통과는 승격 근거가 아니에요', // [추론]
    colItem: '평가 항목', colStatus: '상태', colExpected: '기대', colActual: '결과', colDowngradeReason: '낮춤', colMisclass: '오인', colTime: '시간', // [추론]
  },
  shell: {
    quick: '지름길', quickUpload: '작품 올리기', quickList: '한눈에 보기', quickUploadShort: '올리기', quickListShort: '목록', menuOpen: '메뉴', // D34 ④ 미술관 셸(작업 지시) [추론]
    appName: '우리 아이 미술관',
    opsName: '운영 화면',
    role: { operator: '서비스 운영자', evaluator: '평가 담당', integrator: '연동 개발' } as Record<string, string>,
    menu: { status: '상태-지표', models: '모델 평가', modelsRead: '모델 평가(읽기)', apiGuide: 'API활용' },
    appMenu: { artworks: '작품 관리', children: '우리 아이', family: '가족 보호자', gallery: '미술관', upload: '작품 올리기', town: '미술관 마을', friends: '친구 초대' }, // D52: 마을 · 친구가 메뉴에 보이게 // 전시실 홈 개정안(SD_02 §17-2): 목록은 '작품 관리', 전시는 '미술관'
  },
} as const;

/** gate·reason 사전(docs/C/C_화면문구.md §3). 키는 `G번호:reason`, gate 없는 사유는 `-:reason`. */
const P: Record<string, ProblemCopy> = {
  'G0:not_found': { variant: 'final', summary: '찾을 수 없어요', reason: '찾을 수 없어요', releaser: '없음', self: false, actions: ['목록으로'] },
  '-:not_found': { variant: 'final', summary: '찾을 수 없어요', reason: '찾을 수 없어요', releaser: '없음', self: false, actions: ['목록으로'] },
  'G0:bad_credentials': { variant: 'block', summary: '로그인하지 못했어요', reason: '이메일 또는 비밀번호가 맞지 않아요', releaser: SELF, self: true, actions: ['다시 입력하기', '로그인 정보를 잊었어요'] },
  '-:bad_credentials': { variant: 'block', summary: '로그인하지 못했어요', reason: '이메일 또는 비밀번호가 맞지 않아요', releaser: SELF, self: true, actions: ['다시 입력하기', '로그인 정보를 잊었어요'] },
  '-:email_unverified': { variant: 'block', summary: '메일 확인 전이에요', reason: '메일 확인을 아직 하지 않았어요', releaser: '보호자', self: true, actions: ['확인 메일 다시 받기'] },
  'G30:no_check_sample': { variant: 'block', summary: '점검할 사진 없음', reason: '점검할 평가 묶음 사진이 없어요', releaser: '평가 담당 - 평가 묶음 항목 등록', self: false, actions: [] },
  'G30:not_check_sample': { variant: 'block', summary: '점검할 사진 없음', reason: '이 모델에 맞는 평가 묶음 사진이 아니에요', releaser: '평가 담당 - 평가 묶음 항목 등록', self: false, actions: [] }, // [추론]
  'G30:version_retired': { variant: 'block', summary: '점검할 수 없어요', reason: '폐기한 버전은 점검할 수 없어요', releaser: '평가 담당 - 다른 버전 고르기', self: false, actions: [] }, // [추론]
  '-:check_in_progress': { variant: 'hold', summary: '점검 중', reason: '점검 중이에요', releaser: '시스템 - 점검이 끝나면 풀림', self: false, actions: [] },
  '-:check_runner_missing': { variant: 'block', summary: '점검 준비 전', reason: '점검을 아직 쓸 수 없어요', releaser: '서비스 운영자 - 점검 실행기 배포', self: false, actions: [] }, // [추론]
  '-:no_version': { variant: 'block', summary: '점검할 버전 없음', reason: '점검할 버전이 없어요', releaser: '평가 담당 - 후보 버전 등록', self: false, actions: [] }, // [추론]
  '-:current_password_mismatch': { variant: 'block', summary: '바꾸지 못했어요', reason: '현재 비밀번호가 맞지 않아요', releaser: SELF, self: true, actions: ['다시 입력하기', '로그인 정보를 잊었어요'] }, // [추론] S0c
  '-:login_attempts': { variant: 'hold', summary: '잠시 기다려 주세요', reason: '로그인 시도가 많아요. 잠시 뒤 다시 해 주세요', releaser: '시스템 - 시간이 지나면 풀림', self: false, actions: ['로그인 정보를 잊었어요'] }, // [추론]
  'G1:role_missing': { variant: 'block', summary: '역할 없음', reason: '이 화면을 볼 역할이 없어요', releaser: '서비스 운영자 - 운영 CLI로 역할 부여', self: false, actions: ['다른 계정으로 로그인'] },
  'G1:bad_credentials': { variant: 'block', summary: '로그인하지 못했어요', reason: '이메일 또는 비밀번호가 맞지 않아요', releaser: '팀원 - 지금 이 화면', self: true, actions: ['다시 입력하기'] },
  'G3:child_not_saved': { variant: 'block', summary: '저장되지 않았어요', reason: '저장되지 않았어요', releaser: SELF, self: true, actions: ['다시 저장'] },
  'G3:decision_not_saved': { variant: 'block', summary: '반영되지 않았어요', reason: '반영되지 않았어요', releaser: SELF, self: true, actions: ['다시 저장'] },
  'G4:alias_blank': { variant: 'block', summary: '별칭 확인', reason: '별칭을 적어 주세요', releaser: SELF, self: true, actions: ['별칭 고치기'] }, // [추론]
  'G4:alias_too_long': { variant: 'block', summary: '별칭 확인', reason: '별칭은 20자까지예요', releaser: SELF, self: true, actions: ['별칭 고치기'] }, // [추론, D22]
  'G4:invalid_fields': { variant: 'block', summary: '별칭 확인', reason: '별칭만 적어 주세요', releaser: SELF, self: true, actions: ['별칭 고치기'] }, // [추론]
  'G5:format': { variant: 'block', summary: '올릴 수 없는 사진', reason: '이 사진은 올릴 수 없어요 - 형식을 확인해 주세요', releaser: SELF, self: true, actions: ['다른 사진 고르기'] }, // [추론 세부]
  'G5:unreadable': { variant: 'block', summary: '올릴 수 없는 사진', reason: '이 사진은 읽을 수 없어요', releaser: SELF, self: true, actions: ['다른 사진 고르기'] }, // [추론 세부]
  'G5:missing_photo': { variant: 'block', summary: '사진 없음', reason: '사진을 골라 주세요', releaser: SELF, self: true, actions: ['다른 사진 고르기'] }, // [추론 세부]
  'G5:over_20mb': { variant: 'block', summary: '사진이 너무 커요', reason: '사진이 너무 커요', releaser: SELF, self: true, actions: ['더 작은 사진 고르기'] }, // D34 ④ 파일 크기 숫자 없음
  'G6:intake_failed': { variant: 'block', summary: '접수되지 않았어요', reason: '접수되지 않았어요, 다시 올려 주세요', releaser: SELF, self: true, actions: ['다시 올리기'] },
  'G8:already_processing': { variant: 'block', summary: '확정할 수 없어요', reason: '이미 만들기 시작했어요', releaser: '보호자 - 결과 확인에서 결정', self: false, actions: ['결과 확인으로'] },
  'G8:deleting': { variant: 'final', summary: '삭제 중', reason: '삭제 중이에요', releaser: '없음', self: false, actions: ['목록으로'] },
  'G8:model_disabled': { variant: 'block', summary: '쓸 수 없는 방식', reason: '지금은 이 방식을 쓸 수 없어요', releaser: '평가 담당 팀원 - 새 버전 승격', self: false, actions: ['다른 방식 고르기'] },
  'G10:decision_not_allowed_in_state': { variant: 'block', summary: '결정할 수 없어요', reason: '작품 상태가 이미 바뀌었어요', releaser: '없음 - 목록에서 다시 열기', self: false, actions: ['목록으로'] },
  'G10:deleting': { variant: 'final', summary: '삭제 중', reason: '삭제 중인 작품이에요', releaser: '없음', self: false, actions: ['목록으로'] },
  'G11:made_on_in_future': { variant: 'block', summary: '저장하지 못했어요', reason: '그린 날은 오늘 이후일 수 없어요', releaser: SELF, self: true, actions: ['그린 날 고치기'] },
  'G11:title_blank': { variant: 'block', summary: '저장하지 못했어요', reason: '제목을 적어 주세요', releaser: SELF, self: true, actions: ['값 고치기'] },
  'G11:invalid_fields': { variant: 'block', summary: '저장하지 못했어요', reason: '제목·그린 날·나이를 확인해 주세요', releaser: SELF, self: true, actions: ['값 고치기'] },
  'G11:story_conflict': { variant: 'block', summary: '먼저 고친 내용이 있어요', reason: '다른 보호자가 먼저 고쳤어요', releaser: SELF, self: true, actions: ['최신 내용 불러오기'] },
  'G11:artwork_deleting': { variant: 'final', summary: '삭제 중', reason: '삭제 중인 작품이에요', releaser: '없음', self: false, actions: ['목록으로'] },
  'G13:model_disabled': { variant: 'block', summary: 'AI 초안 준비 중', reason: 'AI 초안 기능은 아직 사용 조건 확인 중이에요', releaser: '평가 담당 팀원 - 조건 확인 뒤 활성화', self: false, actions: ['기본 문장으로 받기', '직접 쓰기'] },
  'G14:keywords_required': { variant: 'block', summary: '키워드 필요', reason: '키워드를 하나 이상 적거나 골라 주세요', releaser: SELF, self: true, actions: ['키워드 입력'] },
  'G14:tag_not_candidate': { variant: 'block', summary: '키워드 필요', reason: '키워드를 하나 이상 적거나 골라 주세요', releaser: SELF, self: true, actions: ['키워드 입력'] },
  '-:caption_locked': { variant: 'final', summary: '승인한 설명 있음', reason: '이미 승인한 설명이 있어요', releaser: '없음', self: false, actions: ['새로 불러오기'] }, // [추론]
  '-:caption_discarded': { variant: 'block', summary: '버린 초안', reason: '버린 초안이에요', releaser: '보호자 - 새 초안 만들기', self: true, actions: ['새로 불러오기'] }, // [추론]
  '-:body_required': { variant: 'block', summary: '설명 필요', reason: '설명을 적어 주세요', releaser: SELF, self: true, actions: ['설명 입력'] }, // [추론]
  '-:llm_unavailable': { variant: 'block', summary: 'AI 초안 없음', reason: 'AI 초안을 지금 만들 수 없어요', releaser: '시스템', self: false, actions: ['기본 문장으로 받기', '나중에', '직접 쓰기'] }, // [추론]
  'G17:sculpture_not_exposed': { variant: 'block', summary: '3D 준비 전', reason: '3D 조각은 아직 쓸 수 없어요', releaser: '서비스 운영자 - 노출 설정(운영 CLI)', self: false, actions: ['다른 방식 고르기'] },
  'G18:deletion_not_saved': { variant: 'block', summary: '삭제되지 않았어요', reason: '삭제되지 않았어요 - 아무것도 바뀌지 않았어요', releaser: SELF, self: true, actions: ['다시 삭제하기'] },
  'G19:waiting_stop': { variant: 'hold', summary: '멈춤 대기', reason: '만들던 작업이 멈추기를 기다리는 중이에요', releaser: '시스템 - 멈춤 확인 또는 시간 상한', self: false, actions: ['목록으로'] },
  'G20:maker_or_fields': { variant: 'block', summary: '등록할 수 없어요', reason: '팀원이 만든 작품만 등록할 수 있어요', releaser: '평가 담당 - 지금 이 화면', self: true, actions: ['조건 채워 다시 등록'] },
  'G20:input_mismatch': { variant: 'block', summary: '등록할 수 없어요', reason: '팀원이 만든 작품만 등록할 수 있어요', releaser: '평가 담당 - 지금 이 화면', self: true, actions: ['조건 채워 다시 등록'] },
  'G21:hash_mismatch': { variant: 'block', summary: '평가를 시작할 수 없어요', reason: '평가를 시작할 수 없어요 - 해시 불일치', releaser: '평가 담당', self: true, actions: ['재설치·격리 조치 뒤 다시 요청'] }, // [추론 세부]
  'G21:no_eval_items': { variant: 'block', summary: '평가를 시작할 수 없어요', reason: '평가를 시작할 수 없어요 - 평가 항목 없음', releaser: '평가 담당', self: true, actions: ['평가 항목 등록'] }, // [추론 세부]
  'G21:rule_not_evaluated': { variant: 'block', summary: '평가를 시작할 수 없어요', reason: '평가를 시작할 수 없어요 - 규칙 미평가', releaser: '평가 담당', self: true, actions: ['다시 요청'] }, // [추론 세부]
  'G21:version_retired': { variant: 'block', summary: '평가를 시작할 수 없어요', reason: '평가를 시작할 수 없어요 - 폐기된 버전', releaser: '평가 담당', self: true, actions: ['다른 버전 고르기'] }, // [추론 세부]
  'G22:license_unconfirmed': { variant: 'block', summary: '승격할 수 없어요', reason: '승격할 수 없어요 - 라이선스 확인 전', releaser: '평가 담당', self: true, actions: ['라이선스 확인'] }, // [추론 세부]
  'G22:eval_incomplete': { variant: 'block', summary: '승격할 수 없어요', reason: '승격할 수 없어요 - 평가 미완료', releaser: '평가 담당', self: true, actions: ['미완료 재평가'] }, // [추론 세부]
  '-:no_rollback_candidate': { variant: 'final', summary: '되돌릴 후보 없음', reason: '되돌릴 후보가 없어요', releaser: '없음', self: false, actions: ['비활성화'] },
  'G23:not_eval_item': { variant: 'block', summary: '시험 호출할 수 없어요', reason: '평가 묶음 작품만 시험 호출할 수 있어요', releaser: '연동 개발', self: true, actions: ['평가 묶음에서 다시 고르기'] }, // [추론]
  'G27:token_invalid': { variant: 'block', summary: '링크 무효', reason: '링크를 쓸 수 없어요', releaser: '보호자', self: true, actions: ['메일 다시 받기'] },
  'G28:token_invalid': { variant: 'block', summary: '초대 링크 무효', reason: '초대 링크를 쓸 수 없어요. 초대한 분께 다시 요청해 주세요', releaser: '초대한 보호자', self: false, actions: [] },
  'G28:invite_email_mismatch': { variant: 'block', summary: '다른 이메일', reason: '초대받은 이메일로 로그인해 주세요', releaser: '초대받은 사람', self: true, actions: ['로그아웃하고 다시 로그인'] },
  'G28:already_in_family': { variant: 'block', summary: '이미 가족 공간이 있어요', reason: '이미 다른 가족 공간에 속해 있어요', releaser: '초대받은 사람', self: false, actions: ['다른 가족에서 나오기'] }, // [추론]
  'G28:co_guardian_full': { variant: 'block', summary: '두 명 찼어요', reason: '보호자는 두 명까지예요', releaser: '만든 보호자', self: false, actions: [] },
  'G29:co_guardian_full': { variant: 'block', summary: '두 명 찼어요', reason: '보호자는 두 명까지예요', releaser: '만든 보호자', self: false, actions: ['해제하면 다시 초대할 수 있어요'] },
  'G29:invite_owner_only': { variant: 'block', summary: '만든 보호자만', reason: '초대와 해제는 가족 공간을 만든 보호자만 할 수 있어요', releaser: '만든 보호자', self: false, actions: [] }, // [추론]
  'G29:not_family_owner': { variant: 'block', summary: '만든 보호자만', reason: '초대와 해제는 가족 공간을 만든 보호자만 할 수 있어요', releaser: '만든 보호자', self: false, actions: [] }, // [추론]
  'G29:family_owner_cannot_leave': { variant: 'final', summary: '나갈 수 없어요', reason: '가족 공간을 만든 보호자는 나갈 수 없어요', releaser: '없음(U20)', self: false, actions: [] }, // [추론]
};

const FALLBACK: ProblemCopy = { variant: 'block', summary: '마치지 못했어요', reason: '잠시 뒤 다시 해 주세요', releaser: '보호자', self: true, actions: ['다시 하기'] }; // 사전에 없는 사유 전부(fail.generic과 같은 문장)

/** gate+reason 으로 문구를 찾는다. 순서: `G:reason` → `-:reason` → `-:code` → 기본(docs §3 마지막 줄). */
export function problemCopy(p: { gate?: string | null; reason?: string | null; code?: string | null }): ProblemCopy {
  const keys = [p.gate && p.reason ? `${p.gate}:${p.reason}` : '', p.reason ? `-:${p.reason}` : '', p.code ? `-:${p.code}` : ''];
  for (const k of keys) if (k && P[k]) return P[k];
  return FALLBACK;
}

/** 시험·문서 대조용. */
export const problemKeys = Object.keys(P);
