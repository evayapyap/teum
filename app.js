/*
 * 한틈 프로토타입 — 단계 전환 라우터와 화면 동작
 *
 * 리추얼은 한 문서 안에서 단계만 바꾼다. 페이지를 새로 열지 않으므로
 * 지면이 끊기지 않고(RIT-TR-03) 같은 안녕돌 상태를 유지할 수 있다(STONE-FLOW-01·03).
 * 지금 들어 있는 화면은 진입(§4), 마음 선택 1·2·3(§5~7), 환기 전환(§9.1.1),
 * 환기(§9.1.2), 행동(§9.2)이다.
 */

const viewport = document.querySelector("[data-viewport]");
const stepNodes = [...document.querySelectorAll("[data-step]")];
const bottomNav = document.querySelector("[data-bottom-nav]");
const stepIds = stepNodes.map((node) => node.dataset.step);

// 개발용 ?hold=1. 검수 페이지처럼 화면을 고정해 봐야 할 때 자동 전환을 멈춘다.
// 요소를 없애는 것이 아니라 시간에 따른 다음 단계 이동만 멈춘다.
const HOLD = viewport.dataset.hold === "true";

// 개발용 ?phase=air. 환기 화면을 미러링이 아니라 환기 문장 단계로 바로 연다.
const START_PHASE = viewport.dataset.startPhase || "";

// 리추얼 진행 상태. 이후 블록의 저장 상태도 여기에 쌓인다.
const state = {
  // 개발용 ?step= 으로 특정 단계를 바로 열 수 있다. 없으면 진입 화면부터 시작한다.
  step: viewport.dataset.startStep || stepIds[0],
  // 마음 선택 1에서 항목을 고른 뒤부터 하단 메뉴를 숨긴다(NAV-05).
  ritualStarted: false,
  // 마음 선택 1·2·3의 선택값. 화면에 보이는 확정 문구를 그대로 담는다.
  choices: { mind_1: null, mind_2: null, mind_3: null },
  // `한틈 마치기`로 만든 완전한 안녕돌의 수. 저장함의 방사탑 자리다(STONE-FLOW-11).
  // 실제 보관은 B14에서 붙인다. 지금은 한 번의 한틈에 하나만 늘어나는지 세기 위해 둔다.
  stones: 0,
};

const stepNodeById = (id) => stepNodes.find((node) => node.dataset.step === id);

/** 하단 메뉴는 마음 선택 1에서 마음을 고르기 전에만 노출한다(NAV-02·05·06). */
function syncBottomNav() {
  const node = stepNodeById(state.step);
  const allowed = node?.dataset.nav === "true";
  const visible = Boolean(allowed) && !state.ritualStarted;
  bottomNav.hidden = !visible;
  viewport.dataset.navVisible = String(visible);
}

// 단계별 진입·이탈 동작. 각 단계 구현이 여기에 자기 hook을 등록한다.
const stepHooks = {};
let activeHook = null;

// 떠나는 화면을 거두는 시간. tokens.css의 --ht-motion-base와 맞춘다.
const LEAVE_FADE_MS = 220;
const leaveTimers = new Map();

/** 떠나는 화면을 짧은 Fade로 거둔다(RIT-TR-03). 지면과 필드는 계속 보인다. */
function fadeOut(node) {
  if (!node || node.hidden) return;
  window.clearTimeout(leaveTimers.get(node));
  node.dataset.leaving = "true";
  leaveTimers.set(
    node,
    window.setTimeout(() => {
      node.hidden = true;
      delete node.dataset.leaving;
      leaveTimers.delete(node);
    }, LEAVE_FADE_MS),
  );
}

function render(previous) {
  const current = stepNodeById(state.step);

  stepNodes.forEach((node) => {
    if (node === current) return;
    if (node.dataset.step === previous) return;
    window.clearTimeout(leaveTimers.get(node));
    leaveTimers.delete(node);
    node.hidden = true;
    delete node.dataset.leaving;
  });

  window.clearTimeout(leaveTimers.get(current));
  leaveTimers.delete(current);
  delete current.dataset.leaving;
  current.hidden = false;

  // 겹치는 단계는 앞 화면 위에 올라오므로 뒤 화면을 거두지 않는다.
  if (previous && current.dataset.overlay !== "true") fadeOut(stepNodeById(previous));

  // 지면 필드는 단계에 따라 위치와 면적만 바꾼다. app.css가 기하를 정한다.
  // 화면 섹션의 data-step과 헷갈리지 않게 지면에는 다른 이름을 쓴다.
  viewport.dataset.currentStep = state.step;

  // 하단 메뉴 상태는 단계 hook이 정한 뒤에 맞춘다.
  if (activeHook?.leave) activeHook.leave();
  activeHook = stepHooks[state.step] ?? null;
  if (activeHook?.enter) activeHook.enter();

  syncBottomNav();
  document.dispatchEvent(new CustomEvent("ht:step", { detail: { ...state } }));
}

/** 지정한 단계로 이동한다. 없는 id는 무시한다. */
function go(id) {
  if (!stepIds.includes(id) || id === state.step) return;
  const previous = state.step;
  state.step = id;
  render(previous);
}

/** 순서상 다음·이전 단계로 이동한다. 사용자 화면의 `이전`은 B6에서 별도로 만든다. */
function step(offset) {
  const next = stepIds[stepIds.indexOf(state.step) + offset];
  if (next) go(next);
}

/* STEP 0 진입 화면 — 요구사항 정의서 §4
 *
 * ENT-01 진입 문구가 표시된 시점부터 3초 뒤 마음 선택 1로 자동 전환한다.
 * ENT-02 화면 탭으로 건너뛰는 동작과 시작 버튼을 두지 않으므로 입력을 받지 않는다.
 * ENT-08 카운트다운을 화면에 표시하지 않는다.
 *
 * 백그라운드에 두었다가 돌아왔을 때 3초를 계산하는 방식은 §4.2의 후속 항목이다.
 * 프로토타입은 `표시된 시점부터`를 문자 그대로 읽어 화면이 가려진 동안은 세지 않고
 * 남은 시간을 이어 센다. 실기기 검증 뒤 정식 기준을 정한다.
 */
const ENTRY_DURATION = 3000;

stepHooks.entry = (() => {
  let remaining = ENTRY_DURATION;
  let startedAt = null;
  let timer = null;

  const start = () => {
    if (timer !== null || remaining <= 0) return;
    startedAt = performance.now();
    timer = window.setTimeout(() => {
      timer = null;
      go("mind-1");
    }, remaining);
  };

  const pause = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
  };

  document.addEventListener("visibilitychange", () => {
    if (state.step !== "entry") return;
    if (document.hidden) pause();
    else start();
  });

  return {
    enter() {
      remaining = ENTRY_DURATION;
      if (!HOLD && !document.hidden) start();
    },
    leave() {
      pause();
      remaining = ENTRY_DURATION;
    },
  };
})();

/* 마음 선택 공통 동작 — 요구사항 정의서 §8.2
 *
 * SEL-COM-10 선택 즉시 그 항목을 선택 상태로 표시하고 나머지를 잠근다.
 *            같은 탭이 두 번 처리되거나 다른 항목이 연속 선택되지 않게 한다.
 * SEL-COM-11 짧은 선택 확인 뒤 다음 버튼 없이 자동 이동한다. 세 단계가 같은 규칙을 쓴다.
 * SEL-COM-14 이전 단계로 돌아오면 마지막에 고른 항목을 선택 상태로 표시하고 다시 고를 수 있게 한다.
 * SEL-COM-15 이전 단계의 선택을 바꾸면 종속된 이후 단계의 선택값을 즉시 지운다.
 */

// 선택 확인 시간. SEL-COM-12에 따라 정확한 값은 실기기 검증에서 정한다. 현재는 후보값이다.
const SELECTION_CONFIRM_MS = 360;

const CHOICE_SEQUENCE = ["mind_1", "mind_2", "mind_3"];
const NEXT_STEP = { mind_1: "mind-2", mind_2: "mind-3", mind_3: "transition" };
const STEP_CHOICE = { "mind-1": "mind_1", "mind-2": "mind_2", "mind-3": "mind_3" };

/** 바꾼 단계보다 뒤에 있는 선택값을 지운다(SEL-COM-15). */
function clearDownstreamChoices(changedKey) {
  CHOICE_SEQUENCE.slice(CHOICE_SEQUENCE.indexOf(changedKey) + 1).forEach((key) => {
    state.choices[key] = null;
  });
}

function setupChoiceGroup(group) {
  const key = group.dataset.choiceGroup;
  // 마음 선택 2는 방향별로 목록이 따로 있다. 고른 방향의 목록만 노출한다(SEL2-02).
  const forDirection = group.dataset.for ?? null;
  const buttons = [...group.querySelectorAll(".ht-choice")];
  let pending = false;

  const paint = (selectedLabel, lock) => {
    buttons.forEach((button) => {
      const selected = button.dataset.choice === selectedLabel;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = lock && !selected;
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (pending) return;
      pending = true;

      const label = button.dataset.choice;
      if (state.choices[key] !== label) clearDownstreamChoices(key);
      state.choices[key] = label;
      paint(label, true);

      // 마음 선택 1을 고른 즉시 하단 메뉴를 숨긴다(NAV-05).
      if (key === "mind_1") {
        state.ritualStarted = true;
        syncBottomNav();
      }

      window.setTimeout(() => {
        pending = false;
        go(NEXT_STEP[key]);
      }, SELECTION_CONFIRM_MS);
    });
  });

  return {
    key,
    forDirection,
    firstLabel: buttons[0]?.dataset.choice ?? null,
    /** 이 목록을 노출할지 정하고, 노출한다면 마지막 선택을 표시한다(SEL-COM-14). */
    sync() {
      const visible = forDirection === null || forDirection === state.choices.mind_1;
      group.hidden = !visible;
      if (!visible) return;
      pending = false;
      paint(state.choices[key], false);
    },
  };
}

const choiceGroups = [...document.querySelectorAll("[data-choice-group]")].map(setupChoiceGroup);

/** 한 단계의 선택지 목록을 모두 맞춘다. */
function syncChoices(key) {
  choiceGroups.filter((group) => group.key === key).forEach((group) => group.sync());
}

/* 개발용 ?step= 으로 뒤 단계를 바로 열 때 앞 단계의 선택값을 채운다.
 *
 * 실제 흐름에서는 마음 선택 1 → 2 → 3 순서로 값이 쌓이므로 비어 있을 수 없다.
 * 앞 단계를 건너뛰고 열면 마음 선택 2가 노출할 방향을 못 찾고, 환기·행동은
 * 붙일 문장을 못 찾는다. 그래서 각 단계의 첫 항목으로 앞 단계를 채운다.
 */
function seedChoicesUpTo(stepId) {
  const stage = CHOICE_SEQUENCE.indexOf(STEP_CHOICE[stepId] ?? "");
  const needed = stage === -1 ? CHOICE_SEQUENCE.length : stage;

  for (let index = 0; index < needed; index += 1) {
    const key = CHOICE_SEQUENCE[index];
    if (state.choices[key]) continue;
    const group = choiceGroups.find(
      (candidate) =>
        candidate.key === key &&
        (candidate.forDirection === null || candidate.forDirection === state.choices.mind_1),
    );
    state.choices[key] = group?.firstLabel ?? null;
  }
}

if (viewport.dataset.startStep) seedChoicesUpTo(viewport.dataset.startStep);

stepHooks["mind-1"] = {
  enter() {
    // 마음 선택 1은 홈이다. 돌아오면 하단 메뉴를 다시 노출한다(NAV-06).
    state.ritualStarted = false;
    syncChoices("mind_1");
  },
};

stepHooks["mind-2"] = { enter: () => syncChoices("mind_2") };
stepHooks["mind-3"] = { enter: () => syncChoices("mind_3") };

/* 마음 선택 3 → 환기 전환 장면 — 요구사항 정의서 §9.1.1
 *
 * RIT-TR-01 선택 상태를 즉시 표시하고 입력을 잠근 뒤 전환을 시작한다.
 *           잠금과 확인 표시는 setupChoiceGroup이 이미 담당한다.
 * RIT-TR-02 약 2초를 기준으로 설계한다. 정확한 시간과 easing은 실기기 검증에서 확정한다.
 * RIT-TR-03 지면을 끊지 않고 블루 필드만 환기 구도로 이동한다. 이동은 app.css가 맡는다.
 * RIT-TR-04 고정 헤드를 전환 장면에서 먼저 보여주고 환기 화면까지 유지한다.
 * RIT-TR-07 모션 축소 환경에서는 2초의 시각적 움직임을 강제하지 않고 바로 환기로 넘긴다.
 *           헤드는 환기 화면에서 이어서 보이므로 정보 순서는 그대로다.
 */
const TRANSITION_MS = 2000;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

stepHooks.transition = (() => {
  let timer = null;

  return {
    enter() {
      if (HOLD) return;
      const wait = prefersReducedMotion.matches ? 0 : TRANSITION_MS;
      timer = window.setTimeout(() => {
        timer = null;
        go("air");
      }, wait);
    },
    leave() {
      window.clearTimeout(timer);
      timer = null;
    },
  };
})();

/* 환기 화면 — 요구사항 정의서 §9.1.2
 *
 * RIT-AIR-01 전환이 끝나면 고정 헤드 아래에 미러링 문장을 자동으로 표시한다.
 * RIT-AIR-02 미러링 문장은 사용자가 읽을 때까지 유지한다. 시간 경과로 넘기지 않는다.
 * RIT-AIR-03 `이어보기`를 누르면 미러링 문장을 짧은 Fade로 거두고 같은 영역에
 *            환기 문장을 표시한다. 두 문장을 누적하지 않으므로 영역은 하나다.
 * SAVE-03·05 환기 문장이 보인 뒤 `환기 문장 저장하기`를 제공하고,
 *            저장하면 토스트 없이 버튼을 `저장 취소`로 바꾼다.
 *
 * 문구는 템플릿에 적지 않고 `/content/`가 돌려주는 정본 문장을 붙인다.
 */
const CONTENT_URL = viewport.dataset.contentUrl;

// 문장을 바꿀 때 거두는 시간. tokens.css의 --ht-motion-base와 맞춘다.
const SENTENCE_FADE_MS = 220;

// 미러링 문장과 환기 문장을 같은 따옴표 형태로 감싼다. 두 문장의 연속성을 보인다.
const QUOTE_OPEN = "“";
const QUOTE_CLOSE = "”";

/* 줄바꿈은 `/content/`가 이미 의미 단위로 나눠서 돌려준다(`lines`).
 *
 * 가이드 6.4는 `감성적 줄바꿈보다 의미 단위 줄바꿈 우선`을 요구한다. 브라우저의 자동
 * 줄 나누기는 줄 길이만 고르게 맞추고 절 경계를 모르기 때문에 이 요구를 지킬 수 없다.
 * 그래서 쉼표·연결어미를 기준으로 서버에서 나눈다. 규칙과 예외는 build_content.py에 있다.
 */

/* 선택 저장 동작 — 요구사항 정의서 §9.5
 *
 * SAVE-01 환기 문장·행동 제안·공간은 자동 저장하지 않고 고른 항목만 저장한다.
 * SAVE-05 저장에 성공하면 토스트·팝업·완료 문장을 표시하지 않고 버튼을 즉시
 *         `저장 취소` 상태로 바꾼다. 색 변화도 함께 써서 상태를 지속적으로 구분한다.
 * SAVE-06 `저장 취소`를 선택하면 원래 상태로 되돌린다. 취소 완료 메시지도 표시하지 않는다.
 *
 * 세 저장 항목이 같은 규칙을 쓰므로 한 곳에서 처리한다.
 * 저장한 내용을 실제로 보관하는 일은 B14에서 붙인다.
 */
function bindSaveToggle(button) {
  button.addEventListener("click", () => {
    const saved = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!saved));
    button.textContent = saved ? button.dataset.saveLabel : "저장 취소";
  });
}

/** 저장 버튼을 저장 전 상태로 되돌린다. 한틈을 새로 시작할 때 쓴다. */
function resetSaveToggle(button) {
  button.setAttribute("aria-pressed", "false");
  button.textContent = button.dataset.saveLabel;
}

/** 현재 선택 흐름의 리추얼 콘텐츠. 환기·행동 화면이 함께 쓴다. */
const content = { flowId: null, data: null };

async function loadContent() {
  const params = new URLSearchParams(state.choices);
  const key = params.toString();
  if (content.flowId === key) return content.data;

  const response = await fetch(`${CONTENT_URL}?${params}`);
  if (!response.ok) throw new Error(`콘텐츠를 불러오지 못했다 (${response.status})`);

  content.data = await response.json();
  content.flowId = key;
  return content.data;
}

/* 안녕돌 노출 시간 — RIT-AIR-05
 * 완전히 나타난 시점부터 3~5초 보이는 상태를 유지한다. 첫 시험값은 4초로 둔다.
 * 나타나는 데 걸리는 시간은 --ht-stone-motion이며, 그 뒤부터 4초를 센다.
 */
/* 시간은 tokens.css에서 읽는다. 같은 수를 코드에도 적어 두면 편집기로 토큰만 바꿨을 때
   조용히 어긋난다. 토큰을 못 읽는 상황에서만 기본값으로 돌아간다. */
function readMs(token, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const match = raw.match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!match) return fallback;
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

const STONE_APPEAR_MS = readMs("--ht-stone-motion", 1600);
const STONE_VISIBLE_MS = 4000;

const stoneElement = document.querySelector("[data-stone]");

/** 지면의 안녕돌 상태를 바꾼다. 화면마다 따로 두지 않는다(STONE-FLOW-01).
 *
 * 상태는 지면에, 표시자 data-stone은 돌 요소에 둔다. 이름이 같으면
 * `[data-stone]` 선택자가 지면을 먼저 잡는다. data-current-step과 같은 이유다.
 */
function setStone(stateName) {
  if (stateName) viewport.dataset.stoneState = stateName;
  else delete viewport.dataset.stoneState;
}

/** 시작 상태를 확정한 뒤 다음 상태로 넘긴다.
 *
 * 페이지가 열리는 프레임에 바로 최종 상태를 주면 브라우저에 `어디서부터` 움직일지가
 * 없어 트랜지션이 실행되지 않고 결과만 튄다. offsetWidth를 읽어 레이아웃을 강제해
 * 시작 상태를 확정한 뒤 상태를 바꾼다.
 */
function setStoneAfterReflow(stateName) {
  void stoneElement.offsetWidth;
  setStone(stateName);
}

stepHooks.air = (() => {
  const section = stepNodeById("air");
  const screen = section.querySelector("[data-air]");
  const sentence = section.querySelector("[data-air-sentence]");
  const continueButton = section.querySelector("[data-air-continue]");
  const saveButton = section.querySelector('[data-save="air"]');
  const nextButton = section.querySelector("[data-air-next]");
  let swapTimer = null;
  let stoneTimers = [];

  const clearStoneTimers = () => {
    stoneTimers.forEach(window.clearTimeout);
    stoneTimers = [];
  };

  /* 환기 문장이 표시된 뒤 안녕돌이 사용자 입력 없이 나타나고, 보이는 상태를 유지한 뒤
   * 컬러 면 뒤로 사라진다. 그 다음에 `다음으로`가 나타난다(RIT-AIR-04~06).
   * 획득·배치 버튼을 두지 않으므로 사용자 입력이 끼어들지 않는다.
   */
  const runStone = () => {
    clearStoneTimers();
    // 시작 상태(왼쪽·투명)를 확정한 뒤 등장시킨다.
    setStone(null);
    setStoneAfterReflow("visible");
    stoneTimers.push(
      window.setTimeout(() => {
        setStoneAfterReflow("behind");
        stoneTimers.push(
          window.setTimeout(() => {
            nextButton.hidden = false;
          }, STONE_APPEAR_MS),
        );
      }, STONE_APPEAR_MS + STONE_VISIBLE_MS),
    );
  };

  /** 문장을 절별로 한 블록씩 그린다.
   *
   * 환기 문장은 확장절 1·2가 데이터에 따로 있으므로 두 블록으로 나눠 절 경계에서
   * 줄이 바뀌게 한다. 블록 안에서는 줄을 고르게 나눈다(app.css의 text-wrap: balance).
   * 따옴표는 첫 블록 앞과 마지막 블록 뒤에 한 번만 붙인다.
   */
  const paintSentence = (clauses) => {
    const last = clauses.length - 1;

    sentence.replaceChildren(
      ...clauses.flatMap((lines, clauseIndex) =>
        lines.map((text, lineIndex) => {
          const line = document.createElement("span");
          line.className = "ht-air-line";
          const head = clauseIndex === 0 && lineIndex === 0 ? QUOTE_OPEN : "";
          const tail =
            clauseIndex === last && lineIndex === lines.length - 1 ? QUOTE_CLOSE : "";
          line.textContent = `${head}${text}${tail}`;
          return line;
        }),
      ),
    );
  };

  /** 같은 영역의 문장을 Fade로 바꾼다. */
  const swap = (parts) => {
    window.clearTimeout(swapTimer);
    sentence.dataset.fading = "true";
    swapTimer = window.setTimeout(() => {
      paintSentence(parts);
      delete sentence.dataset.fading;
    }, SENTENCE_FADE_MS);
  };

  /** 환기 문장 단계로 넘어간다. `이어보기`와 개발용 ?phase=air가 함께 쓴다. */
  const enterAirPhase = ({ animate }) => {
    screen.dataset.phase = "air";
    // `이어보기`는 역할을 마치고 사라지고, 저장 동작이 자리를 잇는다.
    continueButton.hidden = true;
    saveButton.hidden = false;

    if (animate) {
      swap(content.data.lines.air);
      runStone();
      return;
    }

    // 고정해 보는 경우: 문장과 안녕돌을 바로 보이는 상태로 두고 시간 진행만 멈춘다.
    paintSentence(content.data.lines.air);
    setStone("visible");
    nextButton.hidden = false;
  };

  continueButton.addEventListener("click", () => {
    if (screen.dataset.phase !== "mirror" || !content.data) return;
    enterAirPhase({ animate: !HOLD });
  });

  bindSaveToggle(saveButton);

  nextButton.addEventListener("click", () => go("action"));

  return {
    async enter() {
      window.clearTimeout(swapTimer);
      clearStoneTimers();
      setStone(null);
      screen.dataset.phase = "mirror";
      continueButton.hidden = false;
      saveButton.hidden = true;
      nextButton.hidden = true;
      sentence.replaceChildren();
      delete sentence.dataset.fading;

      try {
        const data = await loadContent();
        if (state.step !== "air") return;

        if (START_PHASE === "air") {
          enterAirPhase({ animate: !HOLD });
          return;
        }

        // RIT-AIR-01 전환이 끝나면 미러링 문장을 자동으로 표시한다.
        paintSentence([data.lines.mirror]);
      } catch (error) {
        // 저장 실패 문구는 아직 미정이므로 화면에 임의 문장을 쓰지 않는다.
        // 콘솔에만 남겨 프로토타입에서 원인을 확인한다.
        console.error(error);
      }
    },
    leave() {
      window.clearTimeout(swapTimer);
      clearStoneTimers();
      /* 행동 단계부터 공간 상세까지 안녕돌을 화면에 노출하지 않는다(STONE-FLOW-02).
         `behind`는 이미 투명하므로 노출되지 않는다. 상태를 비우는 대신 사라진 자리를
         그대로 두어 보이지 않는 동안에도 같은 돌의 상태를 유지하고(STONE-FLOW-03),
         최종 장면이 그 자리에서 되돌아올 수 있게 한다(STONE-FLOW-07). */
      setStone("behind");
    },
  };
})();

/* 행동 화면 — 요구사항 정의서 §9.2
 *
 * 행동 제안과 `이 행동이 만드는 작은 변화`를 한 화면의 연속된 콘텐츠로 보여준다.
 * 문구는 정본 CSV의 `행동 제안` 두 문장이며 `/content/`가 나눠서 돌려준다.
 * 안녕돌은 이 화면에 노출하지 않는다(STONE-FLOW-02). 단계 hook이 상태를 비운다.
 *
 * §17-7에서 행동 화면의 진행 동작은 구체화 전이다. 환기와 같은 `다음으로`를 작업 기준으로 쓴다.
 */
/** 빈 줄로 나뉜 문단을 문단별로 그린다. 문단 사이 간격은 CSS가 준다. */
function paintBlocks(target, blocks) {
  target.replaceChildren(
    ...blocks.map((lines) => {
      const block = document.createElement("span");
      block.className = "ht-text-block";

      for (const line of lines) {
        const span = document.createElement("span");
        span.className = "ht-text-line";
        span.textContent = line;
        block.appendChild(span);
      }

      return block;
    }),
  );
}

/** 서버가 나눈 줄을 블록으로 그린다. */
function paintLines(target, lines) {
  target.replaceChildren(
    ...lines.map((line) => {
      const span = document.createElement("span");
      span.className = "ht-text-line";
      span.textContent = line;
      return span;
    }),
  );
}

stepHooks.action = (() => {
  const section = stepNodeById("action");
  const actionText = section.querySelector("[data-action-text]");
  const changeText = section.querySelector("[data-action-change]");
  const saveButton = section.querySelector('[data-save="action"]');
  const nextButton = section.querySelector("[data-action-next]");

  bindSaveToggle(saveButton);
  nextButton.addEventListener("click", () => go("space"));

  return {
    async enter() {
      // 사라진 자리를 그대로 지킨다. 투명한 상태이므로 노출되지 않는다(STONE-FLOW-02·03).
      setStone("behind");
      actionText.textContent = "";
      changeText.textContent = "";

      try {
        const data = await loadContent();
        if (state.step !== "action") return;
        paintLines(actionText, data.lines.action);
        paintLines(changeText, data.lines.change);
      } catch (error) {
        console.error(error);
      }
    },
  };
})();

/* 공간 화면 — 요구사항 정의서 §9.3
 *
 * 카드와 바텀시트가 한 단계 안에 있다. 시트는 다른 화면이 아니라 같은 지면 위에
 * 올라오는 층이라, 닫는 순간 뒤에 있던 안녕돌이 그대로 드러난다(SPACE-08).
 *
 * SPACE-02 시트를 한 번도 열지 않으면 마지막 장면으로 넘어가지 않는다.
 *          카드의 진행 동작이 `공간 열어보기` 하나뿐이라 구조로 지켜진다.
 * SPACE-05 닫힌 것만 종료 계기로 쓴다. 체류 시간·읽음 여부·사진 열람 개수는 보지 않는다.
 * SPACE-06 아래로 밀어 닫는 동작은 붙이지 않는다.
 * SPACE-07 브라우저 뒤로가기를 시트 닫기로 처리한다. `X`도 같은 경로를 지나도록
 *          history.back()으로 돌려 두 동작의 결과를 하나로 유지한다.
 */
stepHooks.space = (() => {
  const section = stepNodeById("space");
  const intro = section.querySelector("[data-space-intro]");
  const cardPhoto = section.querySelector("[data-space-card-photo]");
  const effect = section.querySelector("[data-space-effect]");
  const openButton = section.querySelector("[data-space-open]");

  const sheet = section.querySelector("[data-space-sheet]");
  const closeButton = section.querySelector("[data-space-close]");
  const spaceName = section.querySelector("[data-space-name]");
  const spaceRegion = section.querySelector("[data-space-region]");
  const gallery = section.querySelector("[data-space-gallery]");
  const dots = section.querySelector("[data-space-dots]");
  const actionText = section.querySelector("[data-space-action]");
  const changeText = section.querySelector("[data-space-change]");
  const saveButton = section.querySelector('[data-save="space"]');

  bindSaveToggle(saveButton);

  let isOpen = false;

  /** 사진 위치 표시를 현재 장에 맞춘다. 표시는 사진 밖에 둔다(SPACE-12). */
  function setDot(index) {
    const marks = [...dots.children];
    marks.forEach((mark, i) => {
      if (i === index) mark.setAttribute("aria-current", "true");
      else mark.removeAttribute("aria-current");
    });
    dots.setAttribute("aria-label", `사진 ${index + 1} / ${marks.length}`);
  }

  function paintGallery(photos) {
    gallery.replaceChildren(
      ...photos.map((photo, index) => {
        const slide = document.createElement("div");
        slide.className = "ht-space-photo";

        const image = document.createElement("img");
        image.className = "ht-space-photo__image";
        image.src = photo.src;
        image.alt = photo.alt;
        // 첫 장만 바로 받는다. 나머지는 사용자가 넘겨볼 때 받으면 된다(SPACE-04).
        image.loading = index === 0 ? "eager" : "lazy";

        slide.appendChild(image);
        return slide;
      }),
    );

    dots.replaceChildren(...photos.map(() => document.createElement("span")));
    // 사진이 한 장뿐이면 넘길 것이 없으므로 표시를 감춘다.
    dots.dataset.single = String(photos.length < 2);
    gallery.scrollLeft = 0;
    setDot(0);
  }

  /* 가운데에 가장 가까운 장을 현재 장으로 본다.
     슬라이드 사이에 간격이 있어 `스크롤량 ÷ 슬라이드 폭`으로는 어긋난다. */
  gallery.addEventListener("scroll", () => {
    const first = gallery.firstElementChild;
    if (!first) return;

    const center = gallery.scrollLeft + gallery.clientWidth / 2;
    let nearest = 0;
    let shortest = Infinity;

    [...gallery.children].forEach((slide, index) => {
      const middle = slide.offsetLeft - first.offsetLeft + slide.offsetWidth / 2;
      const distance = Math.abs(middle - center);
      if (distance < shortest) {
        shortest = distance;
        nearest = index;
      }
    });

    setDot(nearest);
  });

  function paintSpace(space) {
    intro.textContent = space.card.intro;
    cardPhoto.src = space.card.photo.src;
    cardPhoto.alt = space.card.photo.alt;
    cardPhoto.hidden = false;
    paintBlocks(effect, space.card.effect);

    // 공간명과 지역은 카드가 아니라 시트 헤더에서만 쓴다(SPACE-13).
    spaceName.textContent = space.name;
    spaceRegion.textContent = space.region;
    sheet.setAttribute("aria-label", `${space.name} 공간 상세`);

    paintGallery(space.detail.photos);
    paintBlocks(actionText, space.detail.action);
    paintBlocks(changeText, space.detail.change);
  }

  function setSheetOpen(open) {
    isOpen = open;
    // 열림 상태는 지면이 들고 있다. 시트와 스크림이 같은 상태를 본다.
    if (open) viewport.dataset.sheetOpen = "true";
    else delete viewport.dataset.sheetOpen;
    openButton.setAttribute("aria-expanded", String(open));
    sheet.toggleAttribute("inert", !open);
  }

  /** 시트를 연다. 검수 프레임은 기록을 남기지 않고 열린 상태만 본다. */
  function openSheet({ push = true } = {}) {
    if (isOpen) return;
    setSheetOpen(true);
    if (push) window.history.pushState({ htSheet: true }, "");
    sheet.focus({ preventScroll: true });
  }

  /** 시트를 닫고 공간 단계를 지나온 것으로 처리한다(SPACE-05). */
  function closeSheet() {
    if (!isOpen) return;
    setSheetOpen(false);
    go("final");
  }

  openButton.addEventListener("click", () => openSheet());

  closeButton.addEventListener("click", () => {
    // 뒤로가기와 같은 경로를 지나게 해 두 동작의 결과를 하나로 맞춘다(SPACE-07).
    if (window.history.state && window.history.state.htSheet) window.history.back();
    else closeSheet();
  });

  window.addEventListener("popstate", () => {
    if (state.step !== "space" || !isOpen) return;
    closeSheet();
  });

  return {
    async enter() {
      // 카드와 시트가 열려 있는 동안 안녕돌을 노출하지 않는다(STONE-FLOW-02).
      // 사라진 자리는 그대로 지킨다. 최종 장면이 여기서 되돌아온다(STONE-FLOW-03·07).
      setStone("behind");
      setSheetOpen(false);

      try {
        const data = await loadContent();
        if (state.step !== "space") return;
        paintSpace(data.space);

        // 개발용 ?phase=sheet. 검수 페이지가 시트 상태를 바로 본다.
        if (START_PHASE === "sheet") openSheet({ push: false });
      } catch (error) {
        console.error(error);
      }
    },
    leave() {
      setSheetOpen(false);
    },
  };
})();

/* 빛나는 안녕돌 최종 장면 — 요구사항 정의서 §9.4
 *
 * 화면에 두는 것은 `한틈 마치기` 하나뿐이다. 이 단계가 하는 일은 지면의 안녕돌을
 * 빛나는 상태로 되돌리는 것과, 사용자가 한틈을 끝냈을 때 처리하는 것 둘뿐이다.
 *
 * STONE-FLOW-03 시트를 닫은 시점에 같은 안녕돌이 빛나는 형태로 돌아온다.
 * STONE-FLOW-07 사라진 방향에서 되돌아와 같은 돌의 귀환으로 읽히게 한다.
 * STONE-FLOW-08 재등장 모션이 끝난 뒤 자동으로 사라지지 않고 정지 상태로 둔다.
 */
stepHooks.final = (() => {
  const section = stepNodeById("final");
  const modal = section.querySelector("[data-final-modal]");
  const slot = section.querySelector("[data-final-stone-slot]");
  const note = section.querySelector("[data-final-note]");
  const finishButton = section.querySelector("[data-final-finish]");

  finishButton.addEventListener("click", finishHanteum);

  return {
    enter() {
      finishButton.disabled = false;

      // 첫 한틈을 마칠 때만 안녕돌이 무엇인지 알려준다. 그다음부터는 두지 않는다.
      note.hidden = state.stones > 0;

      /* 지면에 있던 돌을 모달 안으로 옮긴다. 새로 만들지 않고 같은 요소를 옮기므로
         한 번의 한틈에서 같은 안녕돌 하나가 유지된다(STONE-FLOW-01). */
      slot.appendChild(stoneElement);

      /* 사라진 자리에서 시작해야 같은 돌이 돌아오는 것으로 읽힌다(STONE-FLOW-07).
         옮기면 진행 중인 전환이 끊기므로, 자리를 옮긴 뒤에 시작 상태를 확정한다.
         개발용 ?step=final로 바로 열면 기본 상태(왼쪽)에 있으므로 여기서 맞춘다. */
      stoneElement.style.transition = "none";
      setStone("behind");
      void stoneElement.offsetWidth;
      stoneElement.style.transition = "";

      // 모달이 먼저 오르고, 그 안에서 돌이 서서히 나타난다.
      section.dataset.finalOpen = "true";
      setStoneAfterReflow("glowing");
      modal.focus({ preventScroll: true });
    },
    leave() {
      delete section.dataset.finalOpen;
      setStone(null);
      returnStoneToGround();
    },
  };
})();

/** 안녕돌을 지면의 제자리로 돌려놓는다.
 *
 * 블루 필드보다 앞에 넣어야 필드가 위에 그려지고, 돌이 컬러 면 뒤로 넘어가는
 * 인상을 유지할 수 있다(RIT-AIR-07). 옮기는 동안 움직임이 보이지 않게 전환을 끈다.
 */
function returnStoneToGround() {
  if (stoneElement.parentElement === viewport) return;

  stoneElement.style.transition = "none";
  viewport.insertBefore(stoneElement, viewport.querySelector("[data-field]"));
  void stoneElement.offsetWidth;
  stoneElement.style.transition = "";
}

/* `한틈 마치기` — STONE-FLOW-10·11·12 · NAV-08
 *
 * 완전한 안녕돌을 하나 만들어 저장함의 방사탑에 반영한 뒤 홈으로 돌아간다.
 * 사이에 완료 화면·추가 선택·대기 단계를 두지 않는다(STONE-FLOW-11).
 * 저장하지 않은 항목이 있어도 묻지 않는다(SAVE-04).
 *
 * 방사탑은 저장함(B14)에서 만든다. 지금은 state.stones로 개수만 센다.
 * 한 번의 한틈에서 하나만 만들어야 하므로 버튼을 즉시 잠가 연타를 막는다.
 * 새로고침 뒤의 중복 방지는 진행 상태를 보관하는 B14에서 함께 정한다.
 */
function finishHanteum() {
  const button = stepNodeById("final").querySelector("[data-final-finish]");
  if (button.disabled) return;
  button.disabled = true;

  state.stones += 1;

  startNewHanteum();
  go("mind-1");
}

/** 다음 한틈을 처음부터 시작할 수 있게 되돌린다. */
function startNewHanteum() {
  state.choices = { mind_1: null, mind_2: null, mind_3: null };
  // 마음을 고르기 전 상태로 돌아가므로 하단 메뉴가 다시 보인다(NAV-08).
  state.ritualStarted = false;

  CHOICE_SEQUENCE.forEach(syncChoices);
  document.querySelectorAll("[data-save]").forEach(resetSaveToggle);
}

/* `이전` 이동 — SEL-COM-13
 * 마음 선택 2·3에 같은 위치의 컨트롤을 두고 브라우저 뒤로가기에만 의존하지 않는다.
 * 돌아간 단계의 hook이 마지막 선택을 다시 표시한다(SEL-COM-14).
 */
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => go(button.dataset.back));
});

window.hanteum = { state, go, step, stepIds, stepHooks, choiceGroups };

render();

/* 개발용 단계 이동 바 */
const devbar = document.querySelector(".ht-devbar");
if (devbar) {
  const stateLabel = devbar.querySelector("[data-dev-state]");
  const jumpButtons = [...devbar.querySelectorAll("[data-dev-go]")];

  devbar.querySelector("[data-dev-prev]").addEventListener("click", () => step(-1));
  devbar.querySelector("[data-dev-next]").addEventListener("click", () => step(1));
  jumpButtons.forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.devGo));
  });

  const syncDevbar = () => {
    const index = stepIds.indexOf(state.step) + 1;
    stateLabel.textContent = `${index} / ${stepIds.length} · ${state.step}`;
    jumpButtons.forEach((button) => {
      button.setAttribute("aria-current", String(button.dataset.devGo === state.step));
    });
  };

  document.addEventListener("ht:step", syncDevbar);
  syncDevbar();
}
