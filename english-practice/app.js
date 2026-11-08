// YouTube Speaking Quiz
// 유튜브 영상 내용으로 영어 문장 만들기·말하기 퀴즈를 만들어 주는 앱.
// Claude API는 브라우저에서 사용자의 API 키로 직접 호출합니다.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm";

const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "ytsq:apiKey";
const STATE_STORAGE = "ytsq:state";
const RATE_STORAGE = "ytsq:rate";
const PASS_SCORE = 80;

const TYPE_LABELS = {
  translate: "🇰🇷→🇺🇸 영작하기",
  keywords: "🧩 단어로 문장 만들기",
  answer: "❓ 내용 질문에 답하기",
  complete: "✍️ 문장 이어 말하기",
  opinion: "💬 내 생각 말하기",
};

const LEVEL_GUIDE = {
  beginner:
    "Beginner (CEFR A2). Target answers are 1 short sentence (6-12 words) using common words and simple tenses. Hints should give most of the structure.",
  intermediate:
    "Intermediate (CEFR B1-B2). Target answers are 1-2 natural sentences using everyday expressions, some phrasal verbs and connectors.",
  advanced:
    "Advanced (CEFR C1). Target answers are 2-3 sentences with nuanced vocabulary, idioms from the video, and complex structures (conditionals, relative clauses).",
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  settingsBtn: $("settingsBtn"),
  settingsCard: $("settingsCard"),
  apiKeyInput: $("apiKeyInput"),
  rememberKey: $("rememberKey"),
  saveKeyBtn: $("saveKeyBtn"),
  clearKeyBtn: $("clearKeyBtn"),
  rateInput: $("rateInput"),
  rateOut: $("rateOut"),
  setupCard: $("setupCard"),
  setupForm: $("setupForm"),
  urlInput: $("urlInput"),
  levelInput: $("levelInput"),
  countInput: $("countInput"),
  transcriptInput: $("transcriptInput"),
  setupError: $("setupError"),
  generateBtn: $("generateBtn"),
  loadingCard: $("loadingCard"),
  loadingText: $("loadingText"),
  videoCard: $("videoCard"),
  player: $("player"),
  videoTitle: $("videoTitle"),
  videoAuthor: $("videoAuthor"),
  summaryKo: $("summaryKo"),
  summaryEn: $("summaryEn"),
  expressionList: $("expressionList"),
  quizCard: $("quizCard"),
  qType: $("qType"),
  qProgress: $("qProgress"),
  progressBar: $("progressBar"),
  qInstruction: $("qInstruction"),
  qPrompt: $("qPrompt"),
  qPromptKo: $("qPromptKo"),
  speakPromptBtn: $("speakPromptBtn"),
  qKeywords: $("qKeywords"),
  hintBox: $("hintBox"),
  qHint: $("qHint"),
  answerInput: $("answerInput"),
  interim: $("interim"),
  micBtn: $("micBtn"),
  micNote: $("micNote"),
  submitBtn: $("submitBtn"),
  skipBtn: $("skipBtn"),
  quizError: $("quizError"),
  feedback: $("feedback"),
  scoreCircle: $("scoreCircle"),
  scoreNum: $("scoreNum"),
  verdict: $("verdict"),
  correctedText: $("correctedText"),
  naturalText: $("naturalText"),
  pointList: $("pointList"),
  feedbackKo: $("feedbackKo"),
  retryBtn: $("retryBtn"),
  nextBtn: $("nextBtn"),
  resultCard: $("resultCard"),
  resultSummary: $("resultSummary"),
  resultList: $("resultList"),
  reviewBtn: $("reviewBtn"),
  moreBtn: $("moreBtn"),
  newVideoBtn: $("newVideoBtn"),
};

// ---------- Safe storage ----------
const store = {
  get(area, key) {
    try { return window[area].getItem(key); } catch { return null; }
  },
  set(area, key, value) {
    try { window[area].setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(area, key) {
    try { window[area].removeItem(key); } catch { /* storage unavailable */ }
  },
};

function getApiKey() {
  return store.get("localStorage", KEY_STORAGE) || store.get("sessionStorage", KEY_STORAGE) || "";
}

// ---------- State ----------
/**
 * state = {
 *   video: { id, url, title, author },
 *   level, count, transcript, brief,
 *   quiz: { summary_ko, summary_en, key_expressions[], questions[] },
 *   results: { [questionIndex]: { answer, grade, skipped, attempts } },
 *   queue: number[],   // question indices to go through in this round
 *   pos: number,       // position in queue
 *   answered: boolean, // current question has feedback showing
 * }
 */
let state = null;
let spokenThisAttempt = false;

function saveState() {
  if (state) store.set("localStorage", STATE_STORAGE, JSON.stringify(state));
}

function show(...cards) {
  for (const c of [el.setupCard, el.loadingCard, el.videoCard, el.quizCard, el.resultCard]) {
    c.classList.toggle("hidden", !cards.includes(c));
  }
}

// ---------- YouTube helpers ----------
function parseYouTubeId(raw) {
  let url;
  try {
    url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

async function fetchVideoInfo(id) {
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const endpoints = [
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.title) return { title: data.title, author: data.author_name || "" };
    } catch {
      /* try next */
    }
  }
  return { title: "", author: "" };
}

// ---------- Claude ----------
class FriendlyError extends Error {}

function makeClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new FriendlyError("먼저 오른쪽 위 ⚙️ 설정에서 Anthropic API 키를 저장해 주세요.");
  }
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function friendlyError(err) {
  if (err instanceof FriendlyError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않아요. ⚙️ 설정에서 키를 다시 확인해 주세요.";
  if (err instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 요청할 권한이 없어요. Anthropic 콘솔에서 키 권한을 확인해 주세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 잠시 너무 많아요. 30초쯤 뒤에 다시 시도해 주세요.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return "API 크레딧이 부족해요. Anthropic 콘솔의 Billing에서 충전해 주세요.";
    return `요청에 문제가 있어요: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return "네트워크 연결에 실패했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
  if (err instanceof Anthropic.InternalServerError) return "Claude 서버가 잠시 바빠요. 조금 뒤에 다시 시도해 주세요.";
  if (err instanceof Anthropic.APIError) return `API 오류가 발생했어요 (${err.status ?? "?"}): ${err.message}`;
  console.error(err);
  return `문제가 생겼어요: ${err?.message || err}`;
}

/**
 * Claude에 한 번 요청하고 최종 텍스트를 돌려줍니다.
 * schema가 있으면 structured output(JSON)으로 받아 파싱합니다.
 */
async function askClaude({ system, prompt, schema, effort = "medium", tools }) {
  const client = makeClient();
  let messages = [{ role: "user", content: prompt }];
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system,
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    // 안전 분류기가 요청을 거절하면 서버가 권장 모델로 자동 재시도합니다.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(tools ? { tools } : {}),
  };

  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({ ...params, messages });

    if (res.stop_reason === "refusal") {
      throw new FriendlyError("이 영상 내용으로는 퀴즈를 만들 수 없었어요. 다른 영상으로 시도해 주세요.");
    }
    if (res.stop_reason === "pause_turn") {
      // 서버 도구(웹 검색 등)가 길어져 잠시 멈춘 경우: 이어서 진행
      messages = [...messages, { role: "assistant", content: res.content }];
      continue;
    }
    if (res.stop_reason === "max_tokens") {
      throw new FriendlyError("응답이 너무 길어져서 잘렸어요. 문제 수를 줄이거나 자막을 짧게 해서 다시 시도해 주세요.");
    }

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!schema) return text;
    try {
      return JSON.parse(text);
    } catch {
      throw new FriendlyError("응답을 읽는 중 문제가 생겼어요. 다시 시도해 주세요.");
    }
  }
  throw new FriendlyError("응답이 끝나지 않았어요. 다시 시도해 주세요.");
}

const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary_ko", "summary_en", "key_expressions", "questions"],
  properties: {
    summary_ko: { type: "string", description: "영상 내용 요약 (한국어, 3-4문장)" },
    summary_en: { type: "string", description: "Same summary in simple English (3-4 sentences)" },
    key_expressions: {
      type: "array",
      description: "5-8 useful expressions from the video",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["expression", "meaning_ko", "example"],
        properties: {
          expression: { type: "string" },
          meaning_ko: { type: "string" },
          example: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "instruction_ko", "prompt", "prompt_ko", "keywords", "hint_ko", "model_answer"],
        properties: {
          type: { type: "string", enum: Object.keys(TYPE_LABELS) },
          instruction_ko: { type: "string" },
          prompt: { type: "string" },
          prompt_ko: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          hint_ko: { type: "string" },
          model_answer: { type: "string" },
        },
      },
    },
  },
};

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict_ko", "corrected", "natural", "points", "feedback_ko"],
  properties: {
    score: { type: "integer", description: "0-100" },
    verdict_ko: { type: "string" },
    corrected: { type: "string" },
    natural: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["wrong", "right", "why_ko"],
        properties: {
          wrong: { type: "string" },
          right: { type: "string" },
          why_ko: { type: "string" },
        },
      },
    },
    feedback_ko: { type: "string" },
  },
};

const QUIZ_SYSTEM = `You are a friendly English speaking coach for a Korean learner.
You build sentence-production quizzes from the content of a YouTube video. The learner answers out loud (speech-to-text) or by typing, so every question must make them PRODUCE their own English sentence — never multiple choice, never yes/no.

Question types (use a varied mix, ordered from easier to harder; at least one of each when there are 5 or more questions):
- translate: "prompt" is a natural Korean sentence about the video whose natural English version uses a key expression from the video. "prompt_ko" is "".
- keywords: "prompt" is a short English situation from the video; "keywords" lists 2-4 English words/phrases the answer must use.
- answer: "prompt" is an open English question about what the video said (who/what/why/how), answerable in a sentence or two.
- complete: "prompt" is the beginning of an English sentence about the video ending with "..."; the learner finishes it.
- opinion: "prompt" is an English question asking the learner's own view or experience related to the video's topic.

Field rules:
- instruction_ko: one short Korean instruction telling the learner what to do (e.g. "다음 문장을 영어로 말해 보세요.").
- prompt_ko: Korean translation of an English prompt (empty for translate).
- keywords: only for keywords type (2-4 items); for other types give 0-3 helpful words or an empty array.
- hint_ko: a Korean hint naming a useful structure or expression without giving the full answer.
- model_answer: one natural, spoken-style English answer at the learner's level.
- Base questions on the actual content and expressions of the video. Do not invent facts that are not in the source material; opinion questions may go beyond it.
- Never include timestamps.`;

const GRADE_SYSTEM = `You are a warm but precise English speaking coach for a Korean learner.
Grade the learner's English answer to a quiz question about a YouTube video.

Scoring (0-100): grammar and word choice 40, task completion (answers the question / uses required keywords / matches the Korean meaning) 40, naturalness 20. A fully correct and natural answer gets 90-100 even if it differs from the model answer. Off-topic, Korean-only or empty answers get under 20.
If the answer came from speech recognition, ignore capitalization, punctuation and obvious recognition slips (homophones like "their/there"); do not penalize them.

Fields:
- verdict_ko: a short Korean one-liner (e.g. "완벽해요! 👏", "거의 다 왔어요!", "조금만 더 다듬어 봐요").
- corrected: the learner's own sentence with only the necessary fixes (keep their wording). If nothing needs fixing, repeat it.
- natural: how a native speaker would naturally say it in conversation, at the learner's level.
- points: 0-3 specific fixes ("wrong" fragment → "right" fragment, with a short Korean reason). Empty if perfect.
- feedback_ko: 1-2 encouraging Korean sentences: what was good, and one tip to sound more natural.`;

function sourceBlock() {
  const v = state.video;
  const lines = [
    `Video URL: ${v.url}`,
    `Title: ${v.title || "(unknown)"}`,
    `Channel: ${v.author || "(unknown)"}`,
  ];
  if (state.transcript) {
    lines.push("", "<transcript>", state.transcript, "</transcript>");
  } else if (state.brief) {
    lines.push("", "<video_notes>", state.brief, "</video_notes>");
  }
  return lines.join("\n");
}

async function researchVideo() {
  const v = state.video;
  const prompt = `I want to practice English using this YouTube video, but I don't have its transcript.
Video URL: ${v.url}
Title: ${v.title || "(unknown)"}
Channel: ${v.author || "(unknown)"}

Use web fetch on the video URL and web search as needed to learn what this video actually covers.
Then write English notes (about 250-400 words) covering: the main topic, the key points or story in order, notable facts/examples, and 8-12 expressions the speaker likely uses or that fit the topic.
If you cannot find information about this exact video, say so in one line, then write notes about the topic suggested by the title.`;
  const tools = [
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
    { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  ];
  try {
    return await askClaude({ system: "You research YouTube videos for an English learner.", prompt, tools, effort: "low" });
  } catch (err) {
    // 조직에서 웹 도구가 꺼져 있으면 제목만으로 진행
    if (err instanceof Anthropic.BadRequestError && !/credit balance/i.test(err.message)) {
      return await askClaude({
        system: "You help an English learner.",
        prompt: `${prompt}\n\n(Web tools are unavailable: rely on the title and your own knowledge.)`,
        effort: "low",
      });
    }
    throw err;
  }
}

async function generateQuiz(avoidPrompts = []) {
  const avoid = avoidPrompts.length
    ? `\n\nThe learner already practiced these prompts. Write completely new questions that cover different parts of the content:\n${avoidPrompts.map((p) => `- ${p}`).join("\n")}`
    : "";
  const prompt = `${sourceBlock()}

Learner level: ${LEVEL_GUIDE[state.level]}
Number of questions: exactly ${state.count}.${avoid}`;
  const quiz = await askClaude({ system: QUIZ_SYSTEM, prompt, schema: QUIZ_SCHEMA, effort: "medium" });
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new FriendlyError("문제를 만들지 못했어요. 다시 시도해 주세요.");
  }
  quiz.questions = quiz.questions.filter((q) => TYPE_LABELS[q.type] && q.prompt);
  return quiz;
}

async function gradeAnswer(q, answer, spoken) {
  const prompt = `Video topic summary: ${state.quiz.summary_en}

Question type: ${q.type}
Instruction shown to learner (Korean): ${q.instruction_ko}
Prompt: ${q.prompt}
${q.keywords.length ? `Required/suggested keywords: ${q.keywords.join(", ")}` : ""}
Reference model answer: ${q.model_answer}
Learner level: ${LEVEL_GUIDE[state.level]}
Answer input method: ${spoken ? "speech recognition" : "typed"}

<learner_answer>
${answer}
</learner_answer>`;
  const grade = await askClaude({ system: GRADE_SYSTEM, prompt, schema: GRADE_SCHEMA, effort: "low" });
  grade.score = Math.max(0, Math.min(100, Math.round(Number(grade.score) || 0)));
  return grade;
}

// ---------- Speech ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let recording = false;

function setupSpeech() {
  if (!SpeechRecognition) {
    el.micBtn.classList.add("hidden");
    el.micNote.classList.remove("hidden");
  }
}

function startRecording() {
  if (!SpeechRecognition || recording) return;
  speechSynthesis.cancel();
  const base = el.answerInput.value.trim();
  recognizer = new SpeechRecognition();
  recognizer.lang = "en-US";
  recognizer.interimResults = true;
  recognizer.continuous = true;

  recognizer.onresult = (e) => {
    let finalText = "";
    let interimText = "";
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interimText += t;
    }
    el.answerInput.value = [base, finalText.trim()].filter(Boolean).join(" ");
    el.interim.textContent = interimText;
    spokenThisAttempt = true;
  };
  recognizer.onerror = (e) => {
    const msg = {
      "not-allowed": "마이크 권한이 필요해요. 주소창의 🔒 아이콘에서 마이크를 허용해 주세요.",
      "service-not-allowed": "마이크 권한이 필요해요. 주소창의 🔒 아이콘에서 마이크를 허용해 주세요.",
      "no-speech": "소리가 들리지 않았어요. 🎤 버튼을 누르고 또박또박 말해 보세요.",
      "audio-capture": "마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.",
      network: "음성 인식에 인터넷 연결이 필요해요.",
    }[e.error];
    if (msg) showQuizError(msg);
  };
  recognizer.onend = () => {
    recording = false;
    el.interim.textContent = "";
    el.micBtn.classList.remove("recording");
    el.micBtn.textContent = "🎤 말하기";
  };

  try {
    recognizer.start();
    recording = true;
    hideQuizError();
    el.micBtn.classList.add("recording");
    el.micBtn.textContent = "⏹ 그만 말하기";
  } catch {
    recording = false;
  }
}

function stopRecording() {
  if (recognizer && recording) recognizer.stop();
}

let speechRate = Number(store.get("localStorage", RATE_STORAGE)) || 0.9;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return (
    voices.find((v) => v.lang === lang && /Google|Samantha|Natural|Premium|Enhanced/i.test(v.name)) ||
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.startsWith(prefix)) ||
    null
  );
}

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const lang = /[가-힣]/.test(text) ? "ko-KR" : "en-US";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = lang === "en-US" ? speechRate : 1;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---------- Rendering ----------
function renderVideo() {
  const v = state.video;
  el.player.src = `https://www.youtube-nocookie.com/embed/${v.id}`;
  el.videoTitle.textContent = v.title || "유튜브 영상";
  el.videoAuthor.textContent = v.author ? `채널: ${v.author}` : "";
  el.summaryKo.textContent = state.quiz?.summary_ko || "";
  el.summaryEn.textContent = state.quiz?.summary_en || "";
  el.expressionList.replaceChildren(
    ...(state.quiz?.key_expressions || []).map((x) => {
      const li = document.createElement("li");
      const expr = document.createElement("div");
      expr.className = "expr en";
      expr.textContent = x.expression;
      const meaning = document.createElement("div");
      meaning.textContent = x.meaning_ko;
      const ex = document.createElement("div");
      ex.className = "ex en";
      ex.textContent = x.example;
      li.append(expr, meaning, ex);
      li.addEventListener("click", () => speak(`${x.expression}. ${x.example}`));
      li.title = "눌러서 듣기";
      li.style.cursor = "pointer";
      return li;
    }),
  );
}

function currentIndex() {
  return state.queue[state.pos];
}

function renderQuestion() {
  const qi = currentIndex();
  const q = state.quiz.questions[qi];
  spokenThisAttempt = false;
  stopRecording();

  el.qType.textContent = TYPE_LABELS[q.type];
  el.qProgress.textContent = `${state.pos + 1} / ${state.queue.length}`;
  el.progressBar.style.width = `${(state.pos / state.queue.length) * 100}%`;
  el.qInstruction.textContent = q.instruction_ko;
  el.qPrompt.textContent = q.prompt;
  el.qPrompt.classList.toggle("en", q.type !== "translate");
  el.qPromptKo.textContent = q.prompt_ko || "";
  el.qPromptKo.classList.toggle("hidden", !q.prompt_ko);
  el.qKeywords.replaceChildren(
    ...q.keywords.map((k) => {
      const s = document.createElement("span");
      s.className = "en";
      s.textContent = k;
      return s;
    }),
  );
  el.qHint.textContent = q.hint_ko;
  el.hintBox.open = false;
  el.answerInput.value = "";
  el.interim.textContent = "";
  hideQuizError();
  el.feedback.classList.add("hidden");
  setAnswering(true);
  state.answered = false;
  saveState();
}

function setAnswering(on) {
  el.answerInput.disabled = !on;
  el.micBtn.disabled = !on;
  el.submitBtn.disabled = !on;
  el.skipBtn.disabled = !on;
  el.submitBtn.classList.toggle("hidden", !on);
  el.skipBtn.classList.toggle("hidden", !on);
  el.micBtn.classList.toggle("hidden", !on || !SpeechRecognition);
}

function scoreClass(score) {
  return score >= PASS_SCORE ? "good" : score >= 50 ? "mid" : "bad";
}

function renderFeedback(result) {
  const g = result.grade;
  el.feedback.classList.remove("hidden");
  el.scoreCircle.className = `score-circle ${scoreClass(g.score)}`;
  el.scoreNum.textContent = result.skipped ? "–" : g.score;
  el.verdict.textContent = g.verdict_ko;
  el.correctedText.textContent = g.corrected;
  el.correctedText.parentElement.parentElement.classList.toggle("hidden", !g.corrected);
  el.naturalText.textContent = g.natural;
  el.pointList.replaceChildren(
    ...g.points.map((p) => {
      const li = document.createElement("li");
      const from = document.createElement("span");
      from.className = "from en";
      from.textContent = p.wrong;
      const to = document.createElement("span");
      to.className = "to en";
      to.textContent = p.right;
      li.append(from, " → ", to, document.createElement("br"), p.why_ko);
      return li;
    }),
  );
  el.feedbackKo.textContent = g.feedback_ko;
  const last = state.pos === state.queue.length - 1;
  el.nextBtn.textContent = last ? "결과 보기 →" : "다음 문제 →";
  el.progressBar.style.width = `${((state.pos + 1) / state.queue.length) * 100}%`;
}

function renderResults() {
  const qs = state.quiz.questions;
  const graded = qs.map((q, i) => ({ q, i, r: state.results[i] })).filter((x) => x.r);
  const scored = graded.filter((x) => !x.r.skipped);
  const avg = scored.length ? Math.round(scored.reduce((s, x) => s + x.r.grade.score, 0) / scored.length) : 0;
  const passed = scored.filter((x) => x.r.grade.score >= PASS_SCORE).length;
  el.resultSummary.textContent = scored.length
    ? `평균 ${avg}점 · ${graded.length}문제 중 ${passed}문제 통과 (${PASS_SCORE}점 이상)`
    : "모범답안을 보며 공부했어요. 다음엔 직접 말해 봐요!";

  el.resultList.replaceChildren(
    ...graded.map(({ q, r }) => {
      const li = document.createElement("li");
      const head = document.createElement("div");
      const sc = document.createElement("span");
      sc.className = `r-score ${r.skipped ? "bad" : scoreClass(r.grade.score)}`;
      sc.textContent = r.skipped ? "건너뜀 " : `${r.grade.score}점 `;
      const qText = document.createElement("span");
      qText.className = "r-q";
      qText.textContent = q.prompt;
      head.append(sc, qText);
      li.append(head);
      if (!r.skipped) {
        const mine = document.createElement("div");
        mine.className = "r-line en";
        mine.textContent = `내 답: ${r.answer}`;
        li.append(mine);
      }
      const better = document.createElement("div");
      better.className = "r-line en";
      better.textContent = `추천 표현: ${r.grade.natural}`;
      li.append(better);
      return li;
    }),
  );
  const weak = weakIndices();
  el.reviewBtn.classList.toggle("hidden", weak.length === 0);
  el.reviewBtn.textContent = `아쉬운 문제 다시 풀기 (${weak.length})`;
}

function weakIndices() {
  return state.quiz.questions
    .map((_, i) => i)
    .filter((i) => {
      const r = state.results[i];
      return !r || r.skipped || r.grade.score < PASS_SCORE;
    });
}

function showQuizError(msg) {
  el.quizError.textContent = msg;
  el.quizError.classList.remove("hidden");
}
function hideQuizError() {
  el.quizError.classList.add("hidden");
}
function showSetupError(msg) {
  el.setupError.textContent = msg;
  el.setupError.classList.remove("hidden");
}

// ---------- Flow ----------
const LOADING_STEPS = [
  "영상 내용을 살펴보는 중…",
  "핵심 표현을 고르는 중…",
  "내 수준에 맞는 문제를 만드는 중…",
  "거의 다 됐어요…",
];
let loadingTimer = null;

function startLoading(first) {
  let i = 0;
  el.loadingText.textContent = first || LOADING_STEPS[0];
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = Math.min(i + 1, LOADING_STEPS.length - 1);
    el.loadingText.textContent = LOADING_STEPS[i];
  }, 9000);
}
function stopLoading() {
  clearInterval(loadingTimer);
}

function startRound(queue) {
  state.queue = queue;
  state.pos = 0;
  renderVideo();
  show(el.videoCard, el.quizCard);
  renderQuestion();
  el.quizCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function onGenerate(e) {
  e.preventDefault();
  el.setupError.classList.add("hidden");
  const id = parseYouTubeId(el.urlInput.value);
  if (!id) {
    showSetupError("유튜브 링크를 확인해 주세요. 예: https://www.youtube.com/watch?v=...  또는 https://youtu.be/...");
    return;
  }
  if (!getApiKey()) {
    showSetupError("먼저 ⚙️ 설정에서 Anthropic API 키를 저장해 주세요.");
    el.settingsCard.classList.remove("hidden");
    el.apiKeyInput.focus();
    return;
  }

  state = {
    video: { id, url: `https://www.youtube.com/watch?v=${id}`, title: "", author: "" },
    level: el.levelInput.value,
    count: Number(el.countInput.value),
    transcript: el.transcriptInput.value.trim(),
    brief: "",
    quiz: null,
    results: {},
    queue: [],
    pos: 0,
    answered: false,
  };

  show(el.loadingCard);
  startLoading();
  try {
    Object.assign(state.video, await fetchVideoInfo(id));
    if (!state.transcript) {
      el.loadingText.textContent = "자막이 없어서 영상 정보를 찾아보는 중…";
      state.brief = await researchVideo();
    }
    state.quiz = await generateQuiz();
    stopLoading();
    startRound(state.quiz.questions.map((_, i) => i));
  } catch (err) {
    stopLoading();
    state = null;
    show(el.setupCard);
    showSetupError(friendlyError(err));
  }
}

async function onSubmit() {
  const answer = el.answerInput.value.trim();
  if (!answer) {
    showQuizError("먼저 영어로 말하거나 입력해 주세요.");
    return;
  }
  stopRecording();
  hideQuizError();
  const qi = currentIndex();
  const q = state.quiz.questions[qi];
  setAnswering(false);
  el.submitBtn.classList.remove("hidden");
  el.submitBtn.textContent = "채점 중…";
  try {
    const grade = await gradeAnswer(q, answer, spokenThisAttempt);
    const prev = state.results[qi];
    state.results[qi] = { answer, grade, skipped: false, attempts: (prev?.attempts || 0) + 1 };
    state.answered = true;
    el.submitBtn.classList.add("hidden");
    renderFeedback(state.results[qi]);
    saveState();
  } catch (err) {
    setAnswering(true);
    showQuizError(friendlyError(err));
  } finally {
    el.submitBtn.textContent = "채점하기";
  }
}

function onSkip() {
  stopRecording();
  const qi = currentIndex();
  const q = state.quiz.questions[qi];
  const result = {
    answer: "",
    skipped: true,
    attempts: state.results[qi]?.attempts || 0,
    grade: {
      score: 0,
      verdict_ko: "모범답안을 따라 소리 내어 읽어 보세요 📢",
      corrected: "",
      natural: q.model_answer,
      points: [],
      feedback_ko: "🔊 버튼으로 듣고 2~3번 따라 말해 보면 다음엔 직접 만들 수 있어요.",
    },
  };
  state.results[qi] = result;
  state.answered = true;
  setAnswering(false);
  renderFeedback(result);
  saveState();
}

function onRetry() {
  // 이전 시도 기록(state.results)은 남겨두고, 새로 말하도록 입력창만 비웁니다.
  renderQuestion();
  el.answerInput.focus();
}

function onNext() {
  stopRecording();
  speechSynthesis.cancel();
  if (state.pos < state.queue.length - 1) {
    state.pos += 1;
    renderQuestion();
    el.quizCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    renderResults();
    show(el.videoCard, el.resultCard);
    saveState();
    el.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function onMore() {
  const avoid = state.quiz.questions.map((q) => q.prompt);
  show(el.loadingCard);
  startLoading("새로운 문제를 만드는 중…");
  try {
    const quiz = await generateQuiz(avoid);
    stopLoading();
    state.quiz = quiz;
    state.results = {};
    startRound(quiz.questions.map((_, i) => i));
  } catch (err) {
    stopLoading();
    renderResults();
    show(el.videoCard, el.resultCard);
    alert(friendlyError(err));
  }
}

function onNewVideo() {
  stopRecording();
  state = null;
  store.remove("localStorage", STATE_STORAGE);
  el.player.src = "about:blank";
  el.urlInput.value = "";
  el.transcriptInput.value = "";
  show(el.setupCard);
  window.scrollTo({ top: 0, behavior: "smooth" });
  el.urlInput.focus();
}

// ---------- Settings ----------
function openSettings() {
  el.apiKeyInput.value = getApiKey();
  el.settingsCard.classList.toggle("hidden");
}

function saveKey() {
  const key = el.apiKeyInput.value.trim();
  if (!key) return;
  store.remove("localStorage", KEY_STORAGE);
  store.remove("sessionStorage", KEY_STORAGE);
  store.set(el.rememberKey.checked ? "localStorage" : "sessionStorage", KEY_STORAGE, key);
  el.settingsCard.classList.add("hidden");
  el.setupError.classList.add("hidden");
}

function clearKey() {
  store.remove("localStorage", KEY_STORAGE);
  store.remove("sessionStorage", KEY_STORAGE);
  el.apiKeyInput.value = "";
}

// ---------- Resume ----------
function tryResume() {
  const raw = store.get("localStorage", STATE_STORAGE);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (!saved?.quiz?.questions?.length || !saved.queue?.length) return false;
    state = saved;
    el.urlInput.value = state.video.url;
    renderVideo();
    if (state.answered && state.pos >= state.queue.length - 1) {
      renderResults();
      show(el.videoCard, el.resultCard);
    } else {
      if (state.answered) state.pos = Math.min(state.pos + 1, state.queue.length - 1);
      show(el.videoCard, el.quizCard);
      renderQuestion();
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- Wire up ----------
el.settingsBtn.addEventListener("click", openSettings);
el.saveKeyBtn.addEventListener("click", saveKey);
el.clearKeyBtn.addEventListener("click", clearKey);
el.rateInput.value = String(speechRate);
el.rateOut.textContent = speechRate.toFixed(2);
el.rateInput.addEventListener("input", () => {
  speechRate = Number(el.rateInput.value);
  el.rateOut.textContent = speechRate.toFixed(2);
  store.set("localStorage", RATE_STORAGE, String(speechRate));
});

el.setupForm.addEventListener("submit", onGenerate);
el.micBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));
el.submitBtn.addEventListener("click", onSubmit);
el.skipBtn.addEventListener("click", onSkip);
el.retryBtn.addEventListener("click", onRetry);
el.nextBtn.addEventListener("click", onNext);
el.speakPromptBtn.addEventListener("click", () => speak(el.qPrompt.textContent));
document.querySelectorAll("[data-say]").forEach((btn) =>
  btn.addEventListener("click", () => speak($(btn.dataset.say).textContent)),
);
el.answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit();
});
el.reviewBtn.addEventListener("click", () => startRound(weakIndices()));
el.moreBtn.addEventListener("click", onMore);
el.newVideoBtn.addEventListener("click", onNewVideo);

if ("speechSynthesis" in window) speechSynthesis.getVoices();
setupSpeech();
if (!tryResume()) show(el.setupCard);
if (!getApiKey()) el.settingsCard.classList.remove("hidden");
