# Pterodactyl / Pelican

Deine Spieleserver eines [Pterodactyl](https://pterodactyl.io/)-Panels (oder seines Forks
[Pelican](https://pelican.dev/)) in Gladys: Zustand, CPU, Speicher, Platte und Laufzeit, ein
Schalter zum Starten und Stoppen, Szenenereignisse, wenn ein Server startet, stoppt oder abstürzt,
Szenenaktionen und ein Dashboard-Widget. Zu Hause oder bei einem Spiele-Hoster, der
Pterodactyl-Server verkauft: Die API ist dieselbe.

Getestet mit einem echten Pterodactyl-1.15-Panel und Wings (Start, Stopp, Neustart, Konsole, ein
echter Absturz mit Neustart durch Wings). Pelican behält dieselbe Client-API, wurde aber nicht
getestet: Rückmeldungen sind willkommen auf
[GitHub](https://github.com/guim31/gladys-pterodactyl/issues).

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein Pterodactyl- (1.8 oder neuer) oder Pelican-Panel, das Gladys erreicht.
- Ein **Client-API-Schlüssel** deines Kontos im Panel: **Konto → API-Zugangsdaten → Erstellen**
  (_Account → API Credentials_). Er beginnt mit `ptlc_`. Ein Anwendungsschlüssel (`ptla_`,
  Admin-Bereich) funktioniert nicht. Der Schlüssel sieht die Server, die dir gehören, und die mit
  dir geteilten; ein Subuser braucht die Berechtigungen für das, was Gladys tut (Server lesen,
  Power, Konsole, Aktivität).

## Konfiguration

### Panel und Schlüssel

- **Adresse des Panels**: die Adresse, die du im Browser öffnest, z. B.
  `https://panel.example.com` oder `http://192.168.1.20:8080`.
- **Client-API-Schlüssel (ptlc\_…)**: der oben erstellte Schlüssel.
- **Selbstsigniertes Zertifikat akzeptieren**: nur für ein Panel zu Hause mit HTTPS ohne
  öffentliches Zertifikat.

Speichern: Jeder Server deines Kontos erscheint im Tab **Entdecken**, bereit zum Hinzufügen.
**Verbindung testen** listet deine Server und ihren Zustand.

### Steuerung

Starten, Stoppen und Neustarten sind immer erlaubt, wie im Panel. Zwei riskante Befehle sind
standardmäßig aus:

- **Erzwungenen Stopp erlauben**: beendet den Prozess sofort, das Spiel verliert, was es nicht
  gespeichert hat.
- **Konsolenbefehle erlauben**: Eine Szene kann dann jeden Befehl in die Konsole eines Servers
  eingeben, wie ein Admin.

### Abfragen

- **Abfrageintervall**: standardmäßig 30 Sekunden. Das Panel aktualisiert die Werte eines Servers
  etwa alle 20 Sekunden: Schneller abzufragen zeigt nichts Neues. Jede Abfrage kostet eine Anfrage
  für die Liste und eine pro Server, weit unter dem Limit des Panels (standardmäßig 720 Anfragen pro
  Minute).
- **Sprache der Namen**: der Gerätefunktionen und der Texte, die die Integration schreibt.

## Geräte

Ein Gerät pro Server, mit:

- **Betrieb**: ein Schalter. An, solange der Server läuft oder startet; Einschalten startet den
  Server, Ausschalten stoppt ihn sauber (nie erzwungen). Nach einem Befehl zeigen Schalter und
  Zustand ihn sofort an, bis das Panel ihn bestätigt.
- **Zustand**: Läuft, Startet, Stoppt, Gestoppt, Gesperrt, Installation, Unerreichbar (das Panel
  erreicht den Node nicht).
- **CPU**: gezählt wie im Panel, 100 % ist ein Kern. Die Anzeige reicht bis zum CPU-Limit des
  Servers, ohne Limit bis 400 %.
- **Arbeitsspeicher** und **Speicherplatz**: in Megabyte.
- **Laufzeit**: in Stunden, 0 wenn gestoppt.

CPU und Arbeitsspeicher werden höchstens einmal pro Minute an Gladys gesendet. Die Limits des
Servers (Speicher, Platte, CPU) und sein Node stehen in den Parametern des Geräts. Das Badge des
Geräts unterscheidet ein Panel zu Hause von einem Panel im Internet und zeigt einen roten Punkt,
wenn Panel oder Node nicht antworten.

## Dashboard-Widget

**Spieleserver**: ohne gewählten Server eine Kachel mit den laufenden Servern und die Liste deiner
Server mit Zustand, CPU und Speicher (neun, dann eine Anzahl). Mit einem in den Widget-Einstellungen
gewählten Server: Zustand, CPU, Speicher und Laufzeit, seine Limits und die passenden Tasten:
**Starten**, oder **Neu starten** und **Stoppen** (mit Bestätigung). **Abwürgen** erscheint, wenn es
in der Konfiguration erlaubt ist und der Server beim Stoppen hängt.

## Szenenauslöser

Jeder lässt sich auf einen Server beschränken und liefert den Namen des Servers, seinen Node und
sein Gerät.

- **Ein Spieleserver ist gestartet**: Er läuft, nach einem Start, einem Neustart oder einem Absturz.
- **Ein Spieleserver wurde gestoppt**: auf einen Befehl, von Gladys, dem Panel oder seiner Konsole
  (`stop`, `quit`, `exit`…). Mit den gelaufenen Minuten.
- **Ein Spieleserver ist abgestürzt**: Er hat ohne Befehl gestoppt. Wings startet ihn meist sofort
  neu: Dieses Ereignis kommt dann zuerst, danach **Ein Spieleserver ist gestartet**. Mit den
  gelaufenen Minuten.

So wird ein Absturz erkannt: Der Server ist gestoppt oder seine Laufzeit beginnt wieder bei null,
und weder Gladys noch das Aktivitätsprotokoll des Panels zeigen seit der letzten Abfrage einen
Stopp, erzwungenen Stopp oder Neustart. Ein Server, der aus dem Spiel heraus beendet wird (Mod,
Plugin), zählt als Absturz. Kann der Schlüssel das Aktivitätsprotokoll nicht lesen (ein Subuser ohne
diese Berechtigung), zählt auch ein Stopp aus dem Panel als Absturz: **Verbindung testen** sagt dir,
welcher Fall vorliegt.

## Szenenaktionen

- **Spieleserver starten**, **Spieleserver stoppen** (sauberer Stopp), **Spieleserver neu starten**.
- **Spieleserver abwürgen**: nur wenn in der Konfiguration erlaubt.
- **Konsolenbefehl senden**: nur wenn in der Konfiguration erlaubt, an einen laufenden Server, z. B.
  `say Essen ist fertig!`.
- **Spieleserver abfragen**: liest ihn sofort und gibt den nächsten Schritten, ob er läuft, seinen
  Zustand, CPU, Speicher, Platte und Laufzeit, z. B. für eine Nachricht oder ein „Nur fortfahren,
  wenn“ auf Läuft.

Die Spieler stehen nicht in der API des Panels: Die Integration
[Game Servers (GameDig)](https://github.com/guim31/gladys-gamedig) (gladys-gamedig) liest, wer
spielt, wer kommt und geht, für Minecraft, Valheim und 300 weitere Spiele.

## Szenenbeispiele

- **Der Server der Kinder zur Schlafenszeit**: an Schultagen um 21 Uhr **Konsolenbefehl senden**
  `say Der Server stoppt in 5 Minuten!`, 5 Minuten warten, **Spieleserver stoppen**.
- **Absturz-Alarm**: Auslöser **Ein Spieleserver ist abgestürzt** → mir eine Nachricht mit dem
  Namen des Servers und seinen gelaufenen Minuten senden.
- **Bereit zum Spielen**: Eine Taste im Dashboard startet den Server; Auslöser **Ein Spieleserver
  ist gestartet** → das Licht am Schreibtisch grün schalten und eine Nachricht mit dem Namen des
  Servers senden.

## Fehlerbehebung

- **„API-Schlüssel abgelehnt“**: Der Schlüssel wurde gelöscht, oder es ist ein Anwendungsschlüssel
  (`ptla_`): Erstelle einen Client-Schlüssel unter **Konto → API-Zugangsdaten**.
- **„Panel nicht erreichbar“**: Prüfe Adresse und Port vom Gladys-Rechner aus; ein Panel hinter
  Cloudflare Access oder einer Anmeldeseite kann nicht gelesen werden.
- **„Zertifikat nicht vertrauenswürdig“**: Schalte **Selbstsigniertes Zertifikat akzeptieren** ein
  oder nutze die öffentliche Adresse des Panels.
- **Zustand „Unerreichbar“**: Das Panel antwortet, erreicht aber den Node (Wings) des Servers nicht.
- **Kein Server im Tab Entdecken**: Der Schlüssel sieht keinen Server; der Schlüssel eines Subusers
  sieht nur die mit ihm geteilten Server.
- Ein Server zeigt nach einem Startbefehl bis zu 90 Sekunden **Startet**, bevor das Panel ihn
  bestätigt: Das ist der Cache des Panels.
- Die Protokolle der Integration (Integrationen → Pterodactyl / Pelican → Protokolle) sagen, was
  schiefging; `LOG_LEVEL=debug` zeigt jede Abfrage.

## Grenzen

- Höchstens alle 30 Sekunden eine Abfrage: Ein Absturz mit Neustart durch Wings zwischen zwei
  Abfragen wird an der Laufzeit erkannt; zwei Abstürze zwischen zwei Abfragen zählen als einer.
- Bis zu 200 Server pro Schlüssel.
- Keine Spieler (siehe gladys-gamedig), keine Dateien, Backups, Datenbanken oder Zeitpläne.
- Die Ausgabe der Konsole wird nicht gelesen: Es werden nur Befehle gesendet.
- Keine Verbindung zu Pterodactyl oder Pelican.

## Danksagung

Pterodactyl und Pelican sind das Werk ihrer eigenen Teams. Die API wurde aus ihrer Dokumentation
gelesen und an einem echten Panel geprüft. Code unter der Apache-2.0-Lizenz, im
[Repository der Integration](https://github.com/guim31/gladys-pterodactyl).
