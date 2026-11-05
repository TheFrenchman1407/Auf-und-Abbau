# Heimspieltag-Checkliste (Netlify)

Aufbau und Abbau zum Abhaken, ohne Namen. Alle Geräte sehen live denselben Stand.
Über „Neues Heimspiel“ setzt du die Liste zurück.

## Online stellen
Genau wie bei der Inventur, aber als **eigenes** GitHub-Repo und **eigene** Netlify-Site:
1. Neues GitHub-Repo anlegen, z. B. `heimspieltag`, und den Inhalt dieses Ordners hochladen.
2. Netlify → Import from Git → Repo wählen → Deploy.
3. Unter Environment variables `HALLE_PIN` setzen (darf dieselbe PIN sein wie bei der Inventur) → neu deployen.
4. Visitor access auf „No protection“ lassen.

## Liste ändern
In `public/index.html` ganz oben im Block `SECTIONS` stehen alle Punkte.
Text ändern, Punkt dazu oder weg, dann bei GitHub hochladen. Netlify deployt automatisch.
Jeder Punkt braucht eine eindeutige `id`.
