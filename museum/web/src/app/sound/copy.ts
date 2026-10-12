// 소리 말(D42, SD_02 §17-15). ko.ts는 여러 세션이 함께 고치는 파일이라 이 기능 말은 여기 둔다. ko.ts 금지어를 쓰지 않는다.
export const sc = {
  speak: '들려주기',
  speakStop: '그만 듣기',
  speakLabel: (title: string) => `「${title}」 해설 들려주기`,
  speakStopLabel: (title: string) => `「${title}」 해설 그만 듣기`, // 보이는 글자와 읽히는 이름을 맞춘다(WCAG 2.5.3)
  speakNone: '이 브라우저는 읽어 주기를 지원하지 않아요',
  aiPrefix: 'AI가 쓴 해설이에요.',
  music: '음악',
  musicStop: '음악 끄기',
  musicLabel: '잔잔한 배경 음악',
  musicFail: '지금은 음악을 틀 수 없어요',
  credit: (title: string, performer: string, license: string) => `음악: ${title} — ${performer} (${license})`,
};
