// ─────────────────────────────────────────────────────────────────────────────
// 학원 별칭 사전 (schoolCode → 사용자가 칠 법한 변형들)
//
// 한국 상담사가 실제로 치는 표기를 모두 담는다: 영문코드, 한글음역, 줄임말, 오타변형.
// "점수제에 매몰되지 말고" — 별칭이 맞으면 바로 그 학원으로 확정한다(점수 100).
// 부족하면 계속 추가. 나중에 unresolved 로그를 수집해 여기에 보강한다.
//
// 정규화(normalize: 소문자·공백제거·괄호제거)된 형태로 비교하므로,
// 여기 별칭도 띄어쓰기 신경 안 써도 된다(normalize가 처리).
// ─────────────────────────────────────────────────────────────────────────────

export const SCHOOL_ALIASES: Record<string, string[]> = {
  BCEBU:        ["비세부", "비씨부", "비세뷰", "bcebu", "b세부"],
  BECI:         ["베시", "베씨", "비씨아이", "베씨아이", "beci"],
  BECI_SPARTA:  ["베시스파르타", "베씨스파르타", "beci스파르타", "becisparta", "베씨스파", "베시", "베씨", "beci"],
  BECI_CITY:    ["베시시티", "베씨시티", "beci시티", "becicity", "베씨씨티", "베시", "베씨", "beci"],
  BECI_THE_CAFE:["베시eop", "베씨eop", "beci이오피", "becieop", "베씨카페", "베시카페", "thecafe", "베시", "베씨", "beci"],
  BLUE_OCEAN:   ["블루오션", "블루오숀", "blueocean", "blue ocean", "BO"],
  CELLA_PREMIUM:["셀라", "셀라프리미엄", "cella", "쎌라", "셀라프리"],
  CELLA_UNI:    ["셀라유니", "셀라스파르타", "cellauni"],
  CG_BANILAD:   ["씨지바닐라드", "cg바닐라드", "cgbanilad", "씨지비"],
  CG_SPARTA:    ["씨지스파르타", "cg스파르타", "cgsparta"],
  CIA:          ["씨아이에이", "시아이에이", "cia", "씨아이"],
  CIEC:         ["씨엑", "씨이엑", "ciec", "씨아이이씨"],
  CIJ:          ["씨아이제이", "cij", "씨제이"],
  CPI:          ["씨피아이", "cpi", "시피아이"],
  CNS:          ["씨엔에스", "cns"],
  CLARK_WE:     ["클락위", "클락we", "clarkwe", "위클락"],
  COCO:         ["코코", "보라카이코코", "coco"],
  EFRIENDS:     ["이프렌즈", "이프랜즈", "efriends", "프렌즈", "e프렌즈"],
  EG_ACADEMY:   ["이지", "이지이", "이쥐", "eg", "이지아카데미"],
  ELSA:         ["엘사", "elsa"],
  EMO:          ["이모", "emo"],
  ENGLISH_FELLA_1: ["펠라", "펠라1", "잉글리쉬펠라", "fella", "펠라일", "펠라1캠"],
  ENGLISH_FELLA_2: ["펠라2", "펠라투", "fella2", "펠라2캠"],
  EROOM:        ["이룸", "eroom", "e룸"],
  EV:           ["이브이", "이비", "ev", "이뷔"],
  EV_LAMER:     ["라메르", "이브이라메르", "evlamer", "라머"],
  GITC:         ["지아이티씨", "gitc", "지티씨"],
  GLANT:        ["글랜트", "글란트", "glant", "그란트"],
  GLC:          ["지엘씨", "glc", "글로벌랭귀지"],
  GS:           ["지에스", "gs", "글로벌스탠다드"],
  HANA:         ["하나", "hana", "하나어학원"],
  HELP_CLARK:   ["헬프", "헬프클락", "help", "헬프어학원"],
  IBREEZE:      ["아이브리즈", "아이브리스", "ibreeze", "브리즈", "아이.브리즈"],
  IGEM_CITY:    ["아이젬시티", "아이젬", "igem", "아이쥄"],
  IGEM_MACTAN:  ["아이젬막탄", "igem막탄"],
  IMS:          ["아이엠에스", "ims"],
  JIC_CHALLENGER:["제이아이씨", "jic", "지크챌린저", "jic챌린저"],
  JIC_PREMIUM:  ["jic프리미엄", "지크프리미엄"],
  JJES:         ["제이제이이에스", "jjes", "정준"],
  JOYFUL:       ["조이풀", "joyful", "조이풀에듀"],
  JUNGLE:       ["정글", "jungle", "정글아카데미"],
  LCIC:         ["엘씨아이씨", "lcic", "라푸라푸"],
  LSLC:         ["엘에스엘씨", "lslc", "라살레"],
  MK:           ["엠케이", "mk", "엠케이어학원"],
  MONOL:        ["모놀", "몬올", "monol"],
  PHILINTER:    ["필인터", "필린터", "philinter", "휠인터"],
  PILAEDU:      ["필라에듀", "필라", "pilaedu", "필라edu"],
  PINES:        ["파인스", "파인즈", "pines", "파인스어학원"],
  PINES_MAIN:   ["파인스메인", "파인스메인캠퍼스", "pines메인", "pinesmain", "파인스스피킹", "파인스", "파인즈", "pines"],
  PINES_CHAPIS: ["파인스차피스", "파인스아이엘츠", "파인스ielts", "pineschapis", "pines아이엘츠", "차피스", "파인스", "파인즈", "pines"],
  PJ_ACADEMY:   ["피제이", "피자어학원", "pj", "pj피자", "피제이피자"],
  QQENGLISH_ITP:["큐큐itp", "큐큐아이티파크", "qqitp", "qq아이티파크"],
  QQENGLISH_BFC:["큐큐bfc", "큐큐비치", "qqbfc", "큐큐비프"],
  SMEAG_CAPITAL:["스맥캐피탈", "스미그캐피탈", "smeag캐피탈", "smeagcapital"],
  SMEAG_ENCANTO:["스맥엔칸토", "엔칸토", "smeagencanto"],
  SMEAG_GLOBAL: ["스맥글로벌", "스맥타락", "smeagglobal"],
  TALK:         ["토크", "talk", "토크어학원", "탈크"],
  WALES:        ["웨일스", "웨일즈", "wales"],
  WE_ACADEMY:   ["위아카데미", "weacademy", "we아카데미"],
  CIA_CAMP:     ["씨아이에이캠프", "cia캠프", "씨아이에이가족"],
  CIJ_JUNIOR:   ["씨아이제이주니어", "cij주니어"],
  BANANA_KIDS:  ["바나나키즈", "바나나", "bananakids", "바나나키드"],
  BESTA:        ["베스타", "besta", "베스타라메디", "베스따"],
}

// 위 사전에 더해, 흔한 추가 변형을 런타임에 합칠 수 있게 분리해 둔다(어드민에서 확장 예정).
// 여기 있는 건 코드 기본값; 추후 Firestore 별칭과 병합.
export const EXTRA_ALIASES: Record<string, string[]> = {
  CPILS:        ["씨피아이엘에스", "시필스", "cpils", "씨필스"],  // 학원 본체 생기면 활성
  CWA:          ["씨더블유에이", "cwa"],
  PHILINTER_COMMUTER: ["필인터통학", "필린터통학"],
  EV_LAMER_FAMILY: ["라메르가족", "이브이라메르가족"],
  MONOL_GOLF:   ["모놀골프", "monol골프"],
}
