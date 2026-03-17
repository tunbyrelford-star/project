# WeChat Mini Program Button System Spec

## 1. Goals
- Build a single commercial-grade button language for the entire mini program.
- Keep business logic unchanged while improving visual hierarchy and action clarity.
- Eliminate ad-hoc per-page button styles.

## 2. Component
- Component: `/components/common/button/index`
- Tag: `sl-button`
- Core props:
  - `text`
  - `type`: `primary | secondary | tertiary | danger`
  - `size`: `small | default | large | icon`
  - `disabled`
  - `loading`
  - `block`
  - `icon`
  - `iconPosition`

## 3. Type Rules
- `primary`: only for the page's single key action.
- `secondary`: normal auxiliary operations with equal importance.
- `tertiary`: low-priority tools, quick actions, light navigation.
- `danger`: destructive operations (reject, irreversible reversal).

## 4. Size Rules
- `small`: list cards, inline action rows, compact toolbars.
- `default`: form-level actions, modal actions.
- `large`: fixed bottom action bar.
- `icon`: icon-only operation entry, only when text would be redundant.

## 5. Interaction Rules
- Disabled state must be explicit and not rely on opacity-only tricks.
- Loading state must keep button layout stable.
- Press feedback uses subtle color/border transitions (no glow/heavy effects).
- Bottom action bars use stable white surface + clear primary hierarchy.

## 6. Layout Rules
- List cards: keep only one visible primary/secondary action.
- Detail pages: key action in fixed bottom bar, secondary actions in-card.
- Dialogs/sheets: left cancel (`tertiary`), right confirm (`primary`).
- Multi-button rows: use equal width only when actions are equivalent.

## 7. Migration Scope
- Global token update: `apps/mobile/styles/tokens.wxss`
- Global baseline update: `apps/mobile/styles/base.wxss`
- New component: `apps/mobile/components/common/button/*`
- Shared components and all button-bearing pages migrated to `sl-button`.
