# Interaction State Matrix — Flow Y

Schema: **Element · Zustand · Auslöser · Visuelle Reaktion · Datenänderung · Haptik · Fehlerfall · Nächster Zustand.**
Datenquelle: zentraler Demo-Store (`lib/demo/store.ts`) — Aktionen ändern echten Store-State,
der Feed **und** Profil sichtbar beeinflusst. Zeitgesteuerte Zustände (Reservierung, Frist,
Slot-Events) laufen über Store-Ticks aus echten Ablauf-Timestamps.

## Challenge-Feed
| Zustand | Auslöser | Visuell | Daten | Haptik | Fehler | Nächster |
| --- | --- | --- | --- | --- | --- | --- |
| loading | Mount | Skeleton in Kartenform | store.loading | — | — | ready/empty |
| ready | Daten da | Karten paged | challenges[] | — | — | focused |
| focused | Snap auf Karte | Karte fokussiert, Preview „spielt", Nachbar pausiert | activeId, event challenge_video_started | selection (Snap) | Preview n/a → Fallback-Muster | — |
| empty | 0 sichtbar | Leerzustand + CTA | — | — | — | — |
| end | letzte Karte | „Das war’s"-Fuß + Neu laden | — | — | — | ready |

## Challenge-Karte (kontextuell)
| Zustand | Auslöser | Visuell | Daten | Haptik | Fehler | Nächster |
| --- | --- | --- | --- | --- | --- | --- |
| free (≤ maxSlots) | Slots frei | „N frei", CTA „Mitmachen" | occupiedSlots | — | — | reserving |
| few (≤3) | free ≤ 3 | „Noch N" dringlicher (Akzent) | — | — | — | last |
| last (1) | free == 1 | „Letzter Platz", CTA pulst 1× | — | — | — | reserving/full |
| reserving | reserve() | CTA → Spinner | reservation(pending) | medium | Slot weg → full | reserved |
| reserved | Slot gesichert | Statuschip „Dein Platz · MM:SS" tickt | reservation{expiresAt} | success | — | recording/expired |
| expired | expiresAt < now | Chip „abgelaufen", CTA zurück auf „Mitmachen" | reservation=null | warning | — | free |
| submitted | submission akzeptiert | Karte zeigt „Eingereicht", keine Teilnahme mehr | submission | success | — | voting |
| full | occupied==max | „Voll", CTA deaktiviert, „Merken" bleibt | — | — | — | — |
| closed | status closed/past | keine Teilnahme, „Abstimmung/Beendet" | status | — | — | — |

## Speichern / Teilen
| save default→saved | tap | Stern füllt sofort | saved-Set (persist) | selection | — | saved |
| save saved→default | tap | Stern leert | saved-Set | selection | — | default |
| share | tap | Sheet/Native | event challenge_shared | selection | n/a | — |

## Regeln (Bottom Sheet)
| closed→open | tap Regeln | Sheet slidet, Backdrop dimmt | event rules_opened | light | — | open |
| open→closed | Drag/Backdrop/Verstanden | Sheet schließt | — | — | — | closed |
| **Szenario D** | Frist läuft ab während offen | Sheet zeigt „Challenge beendet", CTA wird „Ansehen" | status→closed | warning | — | closed |

## Teilnahme / Slot-Reservierung
| request | „Mitmachen" | Overlay tritt ein | event participation_requested | medium | — | reserving |
| reserved | reserve() ok | SuccessBurst „Du bist drin · Platz X/Y", Restzeit läuft | reservation, occupiedSlots+1 | success | **Szenario B**: „Letzter Platz vergeben" → Abbruch | armed |
| expired | TTL abgelaufen | „Reservierung abgelaufen" + „Erneut" | reservation=null, occupiedSlots−1 | warning | — | free |
| cancel | „Später" | Overlay schließt, Reservierung bleibt bis TTL | — | — | — | reserved |

## Kamera / Aufnahme
| armed | „Jetzt aufnehmen" | Kamera-Modus (immersiv), Ziel+Zeitlimit+Beweis-Overlay | event recording_ready | — | Kamera verweigert → Fehlerkarte | countdown |
| countdown | Start | 3-2-1-Ring, abbrechbar | — | medium (Tick) | Abbruch → armed | recording |
| recording | Countdown fertig | Puls-Ring + Timer + Beweis-ID + Stop | event recording_started | medium | App-Hintergrund → Warnung/Recover | stopped |
| stopped | Stop | Vorschau erscheint | event recording_stopped, clip | medium | — | preview |
| preview | Clip da | „Erneut" / „Einsenden" | — | — | — | uploading/recording |

## Upload (Statusmaschine Q)
| PREPARING→QUEUED→UPLOADING | Einsenden | Balken läuft aus echtem Progress-Objekt | upload{progress} | — | — | PROCESSING |
| PAUSED | Pause/Offline | Balken hält, „Fortsetzen" | upload.paused | warning | — | UPLOADING |
| RETRYING | **Szenario C** Verbindung weg | „Verbindung verloren — setze fort", auto-resume | upload.retry | warning | mehrfach → FAILED | UPLOADING |
| FAILED | dauerhaft | roter Balken, „Nochmal" | upload.error | error | — | UPLOADING |
| CANCELLED | Abbruch | zurück zu preview, Fortschritt verworfen | upload=null | warning | — | preview |
| PROCESSING | 100 % | „Wird geprüft…" | event submission_processing | — | — | ACCEPTED/REJECTED |

## Einsendung / Folgezustände
| ACCEPTED | processing ok | Erfolgsmoment „Eingereicht", **Karte+Profil wechseln Status** | submission(accepted), challenge.submitted, profile+1 | success-Sequenz | — | feed(submitted) |
| REJECTED | processing nok | ruhiger Fehler „Nicht angenommen" + Grund + „Neu aufnehmen" | submission(rejected) | warning | — | recording |

## Abstimmung / Gewinner / Auszahlung (nachgelagert, im Store modelliert)
| voting | Frist zu | Karte „Abstimmung läuft" | status | — | — | winner |
| winner | Gewinner steht | stärkster Moment: Preis+Challenge+nächste Aktion | winnerId | success-Sequenz | — | payout |
| payout | Auszahlung | seriöser Abschluss, kein Casino | payout | success | — | — |

## Profilfortschritt / Benachrichtigungen
| profile | submission akzeptiert | „Deine Einsendungen"-Zähler +1, Eintrag sichtbar | profile.submissions | — | — | — |
| notification | Store-Event | Badge/Zeile aus Event-Log | events[] | selection | — | — |
