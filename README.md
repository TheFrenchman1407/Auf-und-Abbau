# Hallen-Inventur (Netlify)

Bestand, Nachkaufen, Ausleihe, Defekte und Nutzerverwaltung. Alle Geräte sehen denselben Stand (Aktualisierung alle 5 s).
Die Daten liegen in **Netlify Blobs**.

## Zwei Codes (Netlify → Site configuration → Environment variables)
| Variable | Wofür |
|---|---|
| `MASTER_PIN` | Nur für dich. Wer sich damit anmeldet, ist sofort **Master**: sieht den Reiter „Nutzer“ und schaltet andere frei. |
| `HALLE_PIN` | Freischaltcode für alle anderen (Tablet, Kollege, Präsi). Danach wartet die Anmeldung, bis der Master sie freischaltet. |

Nach dem Setzen oder Ändern: Deploys → Trigger deploy.

## Rollen
- **Master**: alles, plus Nutzer freischalten, sperren und Rollen ändern
- **Bearbeiten**: Bestand ändern (z. B. Hallen-Tablet, Kollege)
- **Nur ansehen**: sieht alles, ändert nichts (z. B. Präsi)

## Online stellen
GitHub-Repo → Netlify „Import from Git“ (siehe frühere Anleitung). Updates: Dateien im Repo ersetzen, dann deployt Netlify automatisch.

## Auf dem Tablet als App
- **iPad:** Safari → Teilen → „Zum Home-Bildschirm“
- **Android:** Chrome → ⋮ → „App installieren“
