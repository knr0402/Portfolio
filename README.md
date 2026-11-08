# Portfolio
 Nari's portfolio

## 🎬 YouTube Speaking Quiz (`english-practice/`)

유튜브 영상 링크를 넣으면, 그 영상의 내용과 주제로 **영어 문장 만들기·말하기 퀴즈**를 만들어 주는 웹 앱이에요.

- **퀴즈 유형:** 한→영 영작, 단어로 문장 만들기, 내용 질문에 답하기, 문장 이어 말하기, 내 생각 말하기
- **말하기 연습:** 🎤 버튼으로 영어로 말하면 음성 인식으로 받아 적어요 (Chrome·Edge·Safari). 입력도 가능해요.
- **채점 & 피드백:** 점수, 고친 문장, 더 자연스러운 표현, 틀린 부분 설명(한국어), 🔊 원어민 발음 듣기
- **복습:** 80점 미만 문제만 다시 풀기, 같은 영상으로 새 문제 만들기, 새로고침해도 이어서 하기
- **수준 선택:** 초급 / 중급 / 고급, 문제 수 5·8·10

### 사용 방법
1. `english-practice/index.html`을 열어요 (GitHub Pages라면 `/english-practice/`).
2. ⚙️ 설정에 [Anthropic API 키](https://console.anthropic.com/settings/keys)를 저장해요. 키는 이 브라우저에만 저장되고 Anthropic API로만 전송돼요.
3. 유튜브 링크를 붙여넣고 **퀴즈 만들기**를 눌러요.
   - 영상 자막을 함께 붙여넣으면(유튜브 설명란 → *스크립트 표시*) 영상에 실제로 나온 표현으로 문제가 나와요.
   - 자막이 없으면 Claude가 웹에서 영상 정보를 찾아 주제 중심으로 문제를 만들어요.

> 빌드 과정 없이 정적 파일(HTML/CSS/JS)로 동작해요. 로컬에서는 `python3 -m http.server` 후 `http://localhost:8000/english-practice/`로 열어 주세요 (마이크 사용은 localhost 또는 https에서만 돼요).
