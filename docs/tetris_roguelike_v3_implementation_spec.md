# 테트리스 로그라이크 대전 액션 v3.1 구현 명세 (엔진/클라 공통)

> 목적: 밸런스/동기화/입력 오해를 줄이기 위해 "실구현 가능한 수준"으로 규칙을 고정한다.

## 0) 용어 및 좌표계

- 보드 기본 크기: `W=10`, `H=20`.
- HP 시스템: `최대 HP = 보드 세로 행 수(H)`.
- 좌표: `x: 0..W-1`, `y: 0..H-1`, `y=0`은 **바닥**.
- 전투 패배: 새 피스를 스폰할 유효 위치가 없을 때 즉시 패배.

---

## 1) 코어 데이터 스키마

```ts
type CellType =
  | 'empty'
  | 'normal'
  | 'highPower'       // 고화력 셀
  | 'specialMana'     // 라인 클리어 시 추가 MP
  | 'specialCleanse'  // 라인 클리어 시 정화 스택
  | 'garbage';

interface Cell {
  type: CellType;
  blockId?: string;      // 소속 피스 인스턴스 id
  cellAttack: number;    // 기본 0.1, 고화력 0.3
  manaBonus: number;     // 기본 0, 특수 마나 셀은 +n
  tags: string[];        // ['custom','eliteReward',...]
}

interface Board {
  width: number;         // default 10
  height: number;        // HP와 동일, default 20
  grid: Cell[][];        // [height][width]
}

interface PieceDef {
  id: string;            // I,J,L,O,S,T,Z, custom_*
  cells: Array<{x:number,y:number}>;
  rotatable: boolean;
  baseCellType: CellType;
  baseCellAttack: number;
  onClearEffect?: 'none' | 'gainMana' | 'cleanseGarbage';
}

interface SkillState {
  skillId: 'compress1x1' | 'purify3' | string;
  mpCost: number;
  cooldownTurn: number;
  cooldownLeft: number;
}

interface PlayerState {
  maxHpRows: number;
  board: Board;
  mp: number;
  mpMax: number;
  gold: number;
  equippedSkills: SkillState[]; // 2~3 슬롯
}

interface DeckState {
  draw: PieceDef[];
  discard: PieceDef[];
  hold?: PieceDef;
  nextQueue: PieceDef[]; // 기본 5
  rngSeed: number;
}

interface EnemyState {
  enemyId: string;
  hp: number;
  aiPatternId: string;
  garbagePressure: number;
  isElite: boolean;
}

interface BattleState {
  round: number; // 1..20
  phase: 'battleStart' | 'playing' | 'resolve' | 'battleEnd' | 'intermission';
  player: PlayerState;
  enemy: EnemyState;
  deck: DeckState;
  activePiece?: PieceDef;
}
```

---

## 2) 전투 상태머신 및 전투 간 지속성

### 2.1 상태 전이

`battleEnd -> intermission(보상/상점/적 선택) -> battleStart -> playing -> resolve -> battleEnd`

### 2.2 전이 시 데이터 유지/초기화 규칙

| 항목 | 전투 종료 | 인터미션 | 다음 전투 시작 |
|---|---|---|---|
| 보드(grid) | 유지 | 유지 | 유지 |
| MP | 유지 | 유지 | 유지 |
| 스킬 장착 | 유지 | 구매/교체 가능 | 반영 |
| `activePiece` | 제거 | - | 신규 스폰 |
| hold | 초기화(권장) | - | 비어있음 |
| draw/discard/nextQueue | 유지 | 유지 | 유지 |
| enemy | 종료 | 새 적 선택 | 새 적 생성 |

### 2.3 전투 종료 프레임 정산 순서(고정)

1. 마지막 락인 후 라인클리어/연쇄/낙하를 전부 정산.
2. 해당 정산 결과의 대미지/MP/특수효과를 적용.
3. 적 HP `<= 0`이면 전투 종료.
4. **정리되지 않은 필드는 그대로 다음 전투로 이월**.

### 2.4 전투 시작 시 적 선공(가비지) 적용 타이밍

- 기본 규칙: `battleStart` 직후, **첫 피스 스폰 전에** 적 선공 패턴 적용.
- 예외 규칙: 튜토리얼/보스 스크립트는 `after first lock`으로 오버라이드 가능.

---

## 3) 대미지/MP/정화 계산 파이프라인

### 3.1 규칙

- 기본 셀 공격력: `0.1`
- 고화력 셀 공격력: `0.3`
- 한 라인 공격력: 해당 라인의 셀 `cellAttack` 총합
- 복수 라인 동시 삭제: 모든 삭제 셀 총합
- 내부 연산: `float` 누적
- UI 표기: 소수점 1자리 반올림

### 3.2 의사코드

```ts
function resolveLineClear(clearedLines: number[], board: Board) {
  let damage = 0.0;
  let mpGain = 0;
  let cleanseStacks = 0;

  for (const y of clearedLines) {
    for (let x = 0; x < board.width; x++) {
      const c = board.grid[y][x];
      if (c.type === 'empty') continue;

      damage += c.cellAttack;      // 0.1 / 0.3 / custom
      mpGain += 1 + c.manaBonus;   // 기본 1 + 보너스
      if (c.type === 'specialCleanse') cleanseStacks += 1;
    }
  }

  return {
    damageToEnemy: Math.round(damage * 10) / 10,
    mpGain,
    cleanseStacks,
  };
}
```

### 3.3 적용 순서(한 프레임 내)

1. 라인 삭제 판정
2. 대미지 계산/적용
3. MP 계산/적용
4. 특수효과 적용(정화, 추가 MP 등)
5. 낙하/중력 정산

### 3.4 테스트 벡터 (필수)

| 케이스 | 구성 | 기대 결과 |
|---|---|---|
| A | 일반 셀 10칸 1라인 | 대미지 1.0 |
| B | 고화력 4칸 + 일반 6칸 | `4*0.3 + 6*0.1 = 1.8` |
| C | 2라인(각 10칸 일반) | 대미지 2.0 |
| D | 특수마나 3칸(`manaBonus=1`) 포함 | MP +3 추가 |
| E | 정화셀 2칸 포함 | `cleanseStacks=2` |

---

## 4) 7-Bag 기반 21장 덱 + 커스텀 합류

### 4.1 기본 21장 생성

```ts
const BASE7 = ['I','J','L','O','S','T','Z'];

function makeBase21(rng): string[] {
  return [...shuffle(BASE7, rng), ...shuffle(BASE7, rng), ...shuffle(BASE7, rng)];
}
```

### 4.2 재생성 규칙

- draw 고갈 시점에만 재생성.
- 기본 21장은 항상 보장.
- 커스텀 블록은 `specialPool`에서 라운드/유물/상점 효과에 따라 0~N장 추가.
- 삽입은 `bag(7장) 단위`로 균등 분산(특정 bag 과밀 방지).

```ts
function rebuildDraw(state): PieceDef[] {
  const base21 = makeBase21(state.rng);
  const specials = rollSpecials(state.specialPool, state.round);
  return interleaveByBag(base21, specials, state.rng);
}
```

### 4.3 소모/버림/미리보기

- 피스가 락인되는 즉시 discard 이동.
- `nextQueue`는 draw에서 선인출(미리보기 5개 유지).
- 전투 종료 시 draw/discard/nextQueue 유지(런 연속성 강화).

---

## 5) 라운드 구조 및 상점

- 총 20라운드.
- 각 라운드 시작 시 2~3개 적 카드 중 선택 진입.
- 일반몹: 표준 보상.
- 엘리트몹: 높은 압박, 높은 보상.
- 상점 고정 출현: `R5, R10, R15`.

상점 판매군:
1. 스킬 획득/교체
2. 특수/고화력 블록 구매 및 덱 추가
3. 최대 HP(보드 높이) 확장권

---

## 6) 20라운드 밸런스 곡선(초안)

- R1~5: 시스템 학습 구간
- R6~10: 빌드 전개
- R11~15: 정리 능력 체크
- R16~20: 생존 + 딜 체크

권장 축:
- 적 HP: 라운드당 +8~12%
- 가비지 압박: 라운드당 +0.5~1.0행/주기
- 엘리트 보상: 골드 1.6x, 희귀 보상 2.0x

---

## 7) 스킬 표준 스펙 (MVP 2종)

### 7.1 긴급 하강 `compress1x1`
- 효과: 현재 active piece를 1x1 조각으로 압축 후 즉시 배치 모드 진입
- 비용: MP 30 (권장)
- 쿨다운: 3턴 (권장)

### 7.2 정화 `purify3`
- 효과: 필드 하단 방해 블록 3줄 즉시 소멸(대미지 계산 제외)
- 비용: MP 60 (권장)
- 쿨다운: 5턴 (권장)

---

## 8) 입력 표준 (PC / Mobile)

### 데스크톱
- ←/→ 이동, ↑ 회전, ↓ 소프트드롭, Space 하드드롭, C 홀드, 1~3 스킬

### 모바일
- 좌하단: 이동(조이스틱 또는 ◀/▶)
- 우하단: 대형 회전
- 회전 인접: 하드드롭/홀드
- 중앙하단: 스킬 칩

오입력 방지:
- 하드드롭 버튼과 타 버튼 간격 확대
- 최소 터치 영역 9mm 상당
- 멀티터치 우선순위: 이동 > 회전 > 스킬 > 하드드롭

---

## 9) MVP 체크리스트

1. HP-연동 가변 높이 보드 + 전투 간 필드 지속성
2. 셀 단위 대미지/MP 계산기
3. 7-Bag×3 + 커스텀 블록 합류
4. 20라운드 + 엘리트 + 상점(5/10/15)
5. 스킬 2종(긴급 하강/정화)
6. PC+모바일 입력 공존
