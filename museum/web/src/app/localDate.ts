// 보호자 기기의 "오늘"(지역 날짜). toISOString()은 UTC라 한국 0~9시에 하루 전 날짜가 된다.
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 2026-09-30 → 2026년 9월 30일 */
export function koDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : (iso ?? '');
}
