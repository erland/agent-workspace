# Agent instructions

Detta projekt utvecklas stegvis enligt `.system-builder/work-status.yaml` och `docs/development-plan.md`.

Vid "Gör nästa steg":

1. Läs `.system-builder/work-status.yaml`.
2. Läs relevant steg i `docs/development-plan.md`.
3. Välj exakt ett säkert development step.
4. Markera steget `in_progress` innan implementation.
5. Implementera endast valt scope och nödvändiga följdändringar.
6. Kör stegets verifiering.
7. Markera steget completed endast efter PASS.
8. Uppdatera docs/state från faktiskt utfall.
9. Stoppa efter ett completed development step.

Funktionell specification och architecture är styrande avsikt. Ändra dem inte för att dölja implementation drift.
