# 캐릭터 커스터마이징 인수인계

- `custom.js`: 파라메트릭 하이커. `createCustom(scene, {skin, hairStyle, hairColor, hat, hatColor, eyes, outfit})`
  - `EYES` / `HATS` / `HAIR` / `OUTFITS` 각 10종 (키와 한글 이름 포함)
  - SDF + surface nets(`sculpt.js`)로 메쉬 생성. 무거우므로 게임에서는 선택 결과를 캐시하거나 미리 구워야 함
  - 시트 렌더는 colour management + ACES 톤매핑 기준. 게임은 ColorManagement off / LinearSRGB 이므로 텍스처 colorSpace 조정 필요
- `sheet.html?s=eyes|hats|hair|outfits`: 시안 시트 렌더 페이지 (vite로 이 폴더 서빙)
- `custom-*.png`: 사용자에게 전달한 시안

## 사용자 요구 (확정)
시안에 나온 모든 요소를 유저가 개별로 커스터마이징:
- 모자, 눈 모양, 눈 색깔(홍채), 피부색, 머리 스타일·색
- 상의, 하의, 신발, 장신구(헤드폰·고글·장갑·게이터·양말·배낭·슬링백·하네스·로프 등)
- 현재 `OUTFITS`는 상·하의·신발·장신구가 한 세트로 묶여 있음 → 부위별 독립 카탈로그(TOPS/BOTTOMS/SHOES/ACCESSORIES)로 분리하고, 각 부위 색상도 선택 가능하게
- 눈 모양과 홍채 색 분리 (현재 EYES에 iris 색이 묶여 있음)
- 성별 선택 없음, 조합으로 남녀 모두 표현

## 다음 작업
1. 사용자가 고른 조합 반영, 포니테일 길이·웃는 눈 다듬기, 손 클로즈업 확인
2. 게임 시작 시 캐릭터 만들기 화면(부위별 탭 + 색상 선택, 실시간 3D 미리보기) 추가
3. 선택 결과를 localStorage 저장, `hero.js` 대체 + 걷기/달리기/점프 애니메이션 연결
4. dev 브랜치 작업 → 프리뷰 주소 전달, "반영해" 시 main 머지 후 프로덕션 주소 전달
