# 미지의 대륙 (voyage)

끝없이 생성되는 판타지 대륙을 3인칭으로 탐험하는 웹 게임. 걸어간 만큼 지도가 밝혀지고, 밝힌 땅만큼 경험치를 얻는다.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (같은 Wi-Fi의 폰에서도 접속 가능)
npm run build    # dist/ 에 배포용 빌드
```

Vercel에서는 Vite 프리셋이 자동 인식된다 (Build: `npm run build`, Output: `dist`).

## 구조

| 파일 | 역할 |
| --- | --- |
| `src/main.js` | 렌더러, 플레이어 물리, 카메라, 메인 루프 |
| `src/noise.js` | 시드 해시, value noise, fbm |
| `src/world.js` | 높이·기후·지형(바이옴)·지면 색·스플랫 가중치 |
| `src/terrainMaterial.js` | 풀/모래/바위/눈 절차적 텍스처 블렌딩 셰이더 |
| `src/chunks.js` | 청크 스트리밍(생성·해제·컬링) |
| `src/vegetation.js` | 나무·바위·선인장 등 식생 정의 |
| `src/hero.js` | 캐릭터 모델과 애니메이션 |
| `src/sky.js` | 하늘·안개·조명·물·구름 |
| `src/input.js` | 조이스틱, 시점 드래그, 키보드, 버튼 |
| `src/progress.js` | 탐험 진행도, XP, 지역 이름, 저장 |
| `src/map.js` | 탐험 지도 오버레이 |

이미지·모델 파일 없이 모든 것을 코드로 생성한다. 같은 시드(`SEED` in `noise.js`)면 모든 기기에서 같은 세계가 나온다.
