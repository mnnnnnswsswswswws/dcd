import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { euro } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { eases, motion, prefersReducedMotion } from '../lib/motion';
import { haptics } from '../lib/haptics';
import { AnimatedPressable } from '../components/motion/AnimatedPressable';
import { AnimatedCounter } from '../components/motion/AnimatedCounter';
import { AnimatedBottomSheet } from '../components/motion/AnimatedBottomSheet';
import { CountdownRing } from '../components/motion/CountdownRing';
import { RecordingPulse } from '../components/motion/RecordingPulse';
import { SuccessBurst } from '../components/motion/SuccessBurst';
import { useDemo } from '../lib/demo/useDemo';
import {
  cancelReservation,
  cancelUpload,
  hasSubmitted,
  pauseUpload,
  reserve,
  reservationRemainingMs,
  resumeUpload,
  retryUpload,
  setScenario,
  startUpload,
  toggleSave,
  type DemoChallenge,
  type Scenario,
} from '../lib/demo/store';

/** Store-getriebener Flow: Feed → Regeln → Teilnahme → Slot-Reservierung (mit
 *  laufender Restzeit) → Aufnahme → Upload (Pause/Resume/Fehler) → Einsendung, die
 *  Karte & Zähler sichtbar verändert. Alle Zustände lesen den zentralen Demo-Store. */
export default function PlayScreen() {
  const s = useDemo();
  const [h, setH] = useState(0);
  const [active, setActive] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height);

  if (s.loading) return <FeedSkeleton onLayout={onLayout} />;

  const acceptedCount = s.submissions.filter((x) => x.status === 'accepted').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
      {/* Kopf: Szenario-Umschalter (Demo) + Live-Zähler eigener Einsendungen (Profilbeweis) */}
      <View style={styles.head}>
        <ScenarioSwitcher current={s.scenario} />
        <View style={styles.subCounter}>
          <Text style={styles.subCounterN}>{acceptedCount}</Text>
          <Text style={styles.subCounterL}>eingereicht</Text>
        </View>
      </View>

      {h > 0 && (
        <ScrollView
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={h - HEAD}
          decelerationRate="fast"
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / (h - HEAD));
            if (idx !== active) {
              setActive(idx);
              haptics.selection();
            }
          }}
        >
          {s.challenges.map((c, i) => (
            <ChallengePage key={c.id} c={c} height={h - HEAD} isActive={i === active} now={s.now} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const HEAD = 44;

/* ------------------------------------------------------------------ */
type Phase = 'idle' | 'reserving' | 'reserved' | 'error' | 'countdown' | 'recording' | 'uploading' | 'done';

function ChallengePage({ c, height, isActive, now }: { c: DemoChallenge; height: number; isActive: boolean; now: number }) {
  const s = useDemo();
  const router = useRouter();
  const [rules, setRules] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [recSec, setRecSec] = useState(0);
  const [errMsg, setErrMsg] = useState('');

  const saved = Boolean(s.saved[c.id]);
  const reservedHere = s.reservation?.challengeId === c.id;
  const submitted = hasSubmitted(c.id);
  const free = Math.max(0, c.maxSlots - c.occupiedSlots);
  const last = free === 1;
  const few = free <= 3 && free > 1;
  const canJoin = c.status === 'open' && !submitted;

  // Karten-Fokus (Feedback, welche Karte „dran" ist).
  const enter = useRef(new Animated.Value(isActive ? 1 : 0.94)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: isActive ? 1 : 0.94, useNativeDriver: true, ...motion.spring.cardExpand }).start();
  }, [isActive, enter]);

  // Overlay tritt räumlich ein.
  const overlay = useRef(new Animated.Value(0)).current;
  const showOverlay = phase !== 'idle';
  useEffect(() => {
    Animated.timing(overlay, { toValue: showOverlay ? 1 : 0, duration: motion.duration.normal, easing: eases.out, useNativeDriver: true }).start();
  }, [showOverlay, overlay]);

  // Upload-Status aus dem Store beobachten → Phase folgt den Daten.
  useEffect(() => {
    if (phase !== 'uploading') return;
    if (s.upload?.status === 'ACCEPTED') setPhase('done');
  }, [s.upload?.status, phase]);

  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (recTimer.current) clearInterval(recTimer.current);
    },
    [],
  );

  function onReserve() {
    setPhase('reserving');
    setTimeout(() => {
      const res = reserve(c.id);
      if (res.ok) {
        haptics.success();
        setPhase('reserved');
      } else {
        haptics.error();
        setErrMsg(res.reason);
        setPhase('error');
      }
    }, 700);
  }
  function startRecording() {
    setRecSec(0);
    setPhase('recording');
    haptics.medium();
    recTimer.current = setInterval(() => setRecSec((x) => x + 1), 1000);
  }
  function stopRecording() {
    if (recTimer.current) clearInterval(recTimer.current);
    haptics.medium();
    startUpload(c.id);
    setPhase('uploading');
  }

  const bg = `hsl(${c.hue} 22% 16%)`;
  const remaining = reservedHere ? reservationRemainingMs() : 0;

  return (
    <View style={{ height, width: '100%' }}>
      <Animated.View style={[styles.page, { transform: [{ scale: enter }], opacity: isActive ? 1 : 0.85 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
        {/* „Bewegte Vorschau" (ehrlicher Ersatz für Video: sanft wanderndes Muster) */}
        {isActive && <MotionPreview hue={c.hue} />}
        <LinearGradient colors={['transparent', 'rgba(12,13,16,0.9)']} locations={[0.38, 1]} style={StyleSheet.absoluteFill} />

        {/* oben: Status + datengetriebener Countdown */}
        <View style={styles.topRow}>
          <StatusChip c={c} submitted={submitted} />
          <CountdownChip expiresAt={c.expiresAt} now={now} />
        </View>

        {/* rechte Leiste */}
        <View style={styles.rail}>
          <AnimatedPressable onPress={() => toggleSave(c.id)} haptic="none" style={styles.railBtn}>
            <View style={[styles.railIcon, saved && styles.railIconOn]}>
              <Text style={[styles.railGlyph, saved && { color: colors.accent }]}>{saved ? '★' : '☆'}</Text>
            </View>
            <Text style={styles.railLabel}>{saved ? 'Gemerkt' : 'Merken'}</Text>
          </AnimatedPressable>
          <View style={styles.railBtn}>
            <View style={styles.railIcon}>
              <Text style={styles.railGlyph}>💬</Text>
            </View>
            <Text style={styles.railLabel}>{c.commentCount}</Text>
          </View>
        </View>

        {/* Inhalt */}
        <View style={styles.content}>
          <View style={styles.byRow}>
            <View style={[styles.byAv, { backgroundColor: c.creator.color }]}>
              <Text style={styles.byAvTxt}>{c.creator.displayName.charAt(0)}</Text>
            </View>
            <Text style={styles.by}>@{c.creator.username}</Text>
            <View style={styles.catPill}>
              <Text style={styles.catTxt}>
                {c.emoji} {c.category}
              </Text>
            </View>
          </View>

          <Text style={styles.title}>{c.title}</Text>

          <View style={styles.prizeRow}>
            <AnimatedCounter value={isActive ? Math.round(c.prizeCents / 100) : 0} format={(n) => euro(n * 100)} style={styles.prize} />
            <Text style={styles.prizeLabel}>Preisgeld</Text>
          </View>

          {/* kontextuelle Slot-/Status-Zeile — Layout & Aktion ändern sich mit dem Zustand */}
          <SlotLine c={c} free={free} few={few} last={last} reservedHere={reservedHere} remaining={remaining} submitted={submitted} />

          <View style={styles.actions}>
            <AnimatedPressable onPress={() => setRules(true)} haptic="light" style={styles.secondary}>
              <Text style={styles.secondaryTxt}>Regeln</Text>
            </AnimatedPressable>
            <PrimaryCTA
              c={c}
              submitted={submitted}
              reservedHere={reservedHere}
              canJoin={canJoin}
              last={last}
              onJoin={onReserve}
              onContinue={() => setPhase('reserved')}
              onView={() => router.push(`/challenge/${c.id}`)}
            />
          </View>
        </View>
      </Animated.View>

      <AnimatedBottomSheet open={rules} onClose={() => setRules(false)}>
        <RulesContent c={c} closed={c.status === 'closed'} onClose={() => setRules(false)} />
      </AnimatedBottomSheet>

      {showOverlay && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.overlay,
            { opacity: overlay, transform: [{ scale: overlay.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
          ]}
        >
          <ParticipationFlow
            phase={phase}
            c={c}
            recSec={recSec}
            errMsg={errMsg}
            remaining={remaining}
            upload={s.upload}
            onArm={() => setPhase('countdown')}
            onCountdownDone={startRecording}
            onStop={stopRecording}
            onPause={pauseUpload}
            onResume={resumeUpload}
            onRetry={retryUpload}
            onCancelUpload={() => {
              cancelUpload();
              setPhase('reserved');
            }}
            onDone={() => setPhase('idle')}
            onCancel={() => setPhase('idle')}
            onErrorBack={() => setPhase('idle')}
          />
        </Animated.View>
      )}
    </View>
  );
}

/* --------------------------- Teil-Komponenten --------------------------- */
function PrimaryCTA({
  c,
  submitted,
  reservedHere,
  canJoin,
  last,
  onJoin,
  onContinue,
  onView,
}: {
  c: DemoChallenge;
  submitted: boolean;
  reservedHere: boolean;
  canJoin: boolean;
  last: boolean;
  onJoin: () => void;
  onContinue: () => void;
  onView: () => void;
}) {
  if (submitted) {
    return (
      <View style={[styles.primary, styles.primaryDone]}>
        <Text style={[styles.primaryTxt, { color: colors.accent }]}>✓ Eingereicht</Text>
      </View>
    );
  }
  if (reservedHere) {
    return (
      <AnimatedPressable onPress={onContinue} haptic="medium" pressScale={0.97} style={styles.primaryWrap}>
        <View style={styles.primary}>
          <Text style={styles.primaryTxt}>Weiter zur Aufnahme</Text>
        </View>
      </AnimatedPressable>
    );
  }
  if (c.status === 'closed') {
    return (
      <AnimatedPressable onPress={onView} haptic="light" style={styles.primaryWrap}>
        <View style={[styles.primary, styles.primaryMuted]}>
          <Text style={[styles.primaryTxt, { color: colors.muted }]}>Ansehen</Text>
        </View>
      </AnimatedPressable>
    );
  }
  if (c.status === 'voting') {
    return (
      <View style={styles.primaryWrap}>
        <View style={[styles.primary, styles.primaryMuted]}>
          <Text style={[styles.primaryTxt, { color: colors.muted }]}>Abstimmung läuft</Text>
        </View>
      </View>
    );
  }
  if (c.status === 'full' || !canJoin) {
    return (
      <View style={styles.primaryWrap}>
        <View style={[styles.primary, styles.primaryMuted]}>
          <Text style={[styles.primaryTxt, { color: colors.muted }]}>Voll</Text>
        </View>
      </View>
    );
  }
  return (
    <AnimatedPressable onPress={onJoin} haptic="medium" pressScale={0.97} style={styles.primaryWrap}>
      <PulseIf on={last}>
        <View style={styles.primary}>
          <Text style={styles.primaryTxt}>{last ? 'Letzten Platz sichern' : 'Mitmachen'}</Text>
        </View>
      </PulseIf>
    </AnimatedPressable>
  );
}

function SlotLine({
  c,
  free,
  few,
  last,
  reservedHere,
  remaining,
  submitted,
}: {
  c: DemoChallenge;
  free: number;
  few: boolean;
  last: boolean;
  reservedHere: boolean;
  remaining: number;
  submitted: boolean;
}) {
  if (submitted) {
    return (
      <View style={styles.slotRow}>
        <View style={[styles.slotDot, { backgroundColor: colors.accent }]} />
        <Text style={styles.slotStrong}>Deine Einsendung ist drin — Community entscheidet.</Text>
      </View>
    );
  }
  if (reservedHere) {
    const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    return (
      <View style={[styles.slotRow, styles.slotReserved]}>
        <View style={[styles.slotDot, { backgroundColor: colors.accent }]} />
        <Text style={styles.slotStrong}>
          Dein Platz ist reserviert · <Text style={{ fontVariant: ['tabular-nums'], color: colors.accent }}>{mm}:{ss}</Text>
        </Text>
      </View>
    );
  }
  if (c.status === 'full') {
    return (
      <View style={styles.slotRow}>
        <View style={[styles.slotDot, { backgroundColor: colors.muted }]} />
        <Text style={styles.slotMuted}>Alle {c.maxSlots} Plätze belegt</Text>
      </View>
    );
  }
  if (c.status === 'closed') {
    return (
      <View style={styles.slotRow}>
        <View style={[styles.slotDot, { backgroundColor: colors.muted }]} />
        <Text style={styles.slotMuted}>Frist abgelaufen · Abstimmung folgt</Text>
      </View>
    );
  }
  if (c.status === 'voting') {
    return (
      <View style={styles.slotRow}>
        <View style={[styles.slotDot, { backgroundColor: '#d3a24a' }]} />
        <Text style={styles.slotMuted}>Abstimmung läuft — Gewinner in Kürze</Text>
      </View>
    );
  }
  return (
    <View style={styles.slotRow}>
      <View style={[styles.slotDot, { backgroundColor: last || few ? colors.accent : colors.muted }]} />
      <Text style={last || few ? styles.slotStrong : styles.slotMuted}>
        {last ? 'Letzter Platz!' : few ? `Nur noch ${free} Plätze` : `${free} von ${c.maxSlots} frei`}
      </Text>
    </View>
  );
}

function ParticipationFlow({
  phase,
  c,
  recSec,
  errMsg,
  remaining,
  upload,
  onArm,
  onCountdownDone,
  onStop,
  onPause,
  onResume,
  onRetry,
  onCancelUpload,
  onDone,
  onCancel,
  onErrorBack,
}: {
  phase: Phase;
  c: DemoChallenge;
  recSec: number;
  errMsg: string;
  remaining: number;
  upload: ReturnType<typeof useDemo>['upload'];
  onArm: () => void;
  onCountdownDone: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancelUpload: () => void;
  onDone: () => void;
  onCancel: () => void;
  onErrorBack: () => void;
}) {
  const place = Math.min(c.maxSlots, c.occupiedSlots);
  return (
    <View style={styles.flowCard}>
      {phase === 'reserving' && (
        <View style={styles.center}>
          <Spinner />
          <Text style={styles.flowLabel}>Reserviere deinen Platz…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.center}>
          <View style={styles.errBadge}>
            <Text style={styles.errBadgeTxt}>!</Text>
          </View>
          <Text style={styles.flowTitle}>Gerade nicht möglich</Text>
          <Text style={styles.flowHint}>{errMsg}</Text>
          <AnimatedPressable onPress={onErrorBack} haptic="light" style={styles.flowPrimary}>
            <Text style={styles.flowPrimaryTxt}>Zurück zum Feed</Text>
          </AnimatedPressable>
        </View>
      )}

      {phase === 'reserved' && (
        <View style={styles.center}>
          <SuccessBurst title="Du bist drin." subtitle={`Platz ${place} von ${c.maxSlots} · reserviert ${fmt(remaining)}`} />
          <AnimatedPressable onPress={onArm} haptic="medium" style={styles.flowPrimary}>
            <Text style={styles.flowPrimaryTxt}>Jetzt aufnehmen</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={onCancel} haptic="none" style={styles.flowGhost}>
            <Text style={styles.flowGhostTxt}>Später — Platz bleibt reserviert</Text>
          </AnimatedPressable>
        </View>
      )}

      {phase === 'countdown' && <CountdownRing from={3} onDone={onCountdownDone} />}

      {phase === 'recording' && (
        <View style={styles.center}>
          <View style={styles.proofOverlay}>
            <Text style={styles.proofTxt}>BEWEIS · {c.id.toUpperCase()}</Text>
          </View>
          <RecordingPulse seconds={recSec} />
          <Text style={styles.flowHint}>Nimm deinen Beweis auf — direkt in der App.</Text>
          <AnimatedPressable onPress={onStop} haptic="medium" style={styles.stopBtn}>
            <View style={styles.stopInner} />
            <Text style={styles.stopTxt}>Stoppen &amp; einsenden</Text>
          </AnimatedPressable>
        </View>
      )}

      {phase === 'uploading' && upload && (
        <View style={styles.center}>
          <Text style={styles.flowTitle}>{uploadTitle(upload.status)}</Text>
          <View style={{ width: '100%', marginTop: 16 }}>
            <View style={styles.upTrack}>
              <View
                style={[
                  styles.upFill,
                  {
                    width: `${Math.round(upload.progress * 100)}%`,
                    backgroundColor: upload.status === 'FAILED' ? '#f2696e' : upload.status === 'RETRYING' ? '#d3a24a' : colors.accent,
                  },
                ]}
              />
            </View>
            <View style={styles.upRow}>
              <Text style={styles.upStatus}>{uploadHint(upload.status)}</Text>
              <Text style={styles.upPct}>{Math.round(upload.progress * 100)}%</Text>
            </View>
          </View>
          <View style={styles.upActions}>
            {upload.status === 'UPLOADING' && (
              <AnimatedPressable onPress={onPause} haptic="light" style={styles.upBtn}>
                <Text style={styles.upBtnTxt}>Pause</Text>
              </AnimatedPressable>
            )}
            {upload.status === 'PAUSED' && (
              <AnimatedPressable onPress={onResume} haptic="medium" style={styles.upBtn}>
                <Text style={styles.upBtnTxt}>Fortsetzen</Text>
              </AnimatedPressable>
            )}
            {upload.status === 'FAILED' && (
              <AnimatedPressable onPress={onRetry} haptic="medium" style={styles.upBtn}>
                <Text style={styles.upBtnTxt}>Nochmal</Text>
              </AnimatedPressable>
            )}
            {(upload.status === 'UPLOADING' || upload.status === 'PAUSED' || upload.status === 'RETRYING') && (
              <AnimatedPressable onPress={onCancelUpload} haptic="light" style={[styles.upBtn, styles.upCancel]}>
                <Text style={[styles.upBtnTxt, { color: colors.muted }]}>Abbrechen</Text>
              </AnimatedPressable>
            )}
          </View>
          <Text style={styles.flowHintSmall}>Du kannst die App normal weiter nutzen.</Text>
        </View>
      )}

      {phase === 'done' && (
        <View style={styles.center}>
          <SuccessBurst title="Eingereicht." subtitle="Und jetzt? Daumen drücken — die Community entscheidet." />
          <AnimatedPressable onPress={onDone} haptic="selection" style={styles.flowPrimary}>
            <Text style={styles.flowPrimaryTxt}>Zurück zum Feed</Text>
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

/** Dezenter Lade-Spinner (rotierender Ring). */
function Spinner() {
  const r = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(Animated.timing(r, { toValue: 1, duration: 900, easing: eases.inout, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [r]);
  const rotate = r.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

function RulesContent({ c, closed, onClose }: { c: DemoChallenge; closed: boolean; onClose: () => void }) {
  const steps = [
    { n: '1', t: 'Platz sichern', d: `Einer von ${c.maxSlots} Plätzen, 10 Min reserviert.` },
    { n: '2', t: 'In der App aufnehmen', d: 'Kein Galerie-Import, kein Schnitt — echt.' },
    { n: '3', t: 'Community entscheidet', d: `Die beste Einsendung gewinnt ${euro(c.prizeCents)}.` },
  ];
  return (
    <View style={styles.rules}>
      <Text style={styles.rulesTitle}>{closed ? 'Diese Challenge ist beendet' : 'So läufst du mit'}</Text>
      {closed ? (
        <Text style={styles.rulesDesc}>Die Frist ist gerade abgelaufen — hier kannst du nicht mehr teilnehmen, aber die Abstimmung ansehen.</Text>
      ) : (
        <View style={{ gap: 14, marginTop: 4 }}>
          {steps.map((s) => (
            <View key={s.n} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumTxt}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.t}</Text>
                <Text style={styles.stepDesc}>{s.d}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <AnimatedPressable onPress={onClose} haptic="medium" style={styles.rulesBtn}>
        <Text style={styles.rulesBtnTxt}>{closed ? 'Abstimmung ansehen' : 'Verstanden'}</Text>
      </AnimatedPressable>
    </View>
  );
}

function StatusChip({ c, submitted }: { c: DemoChallenge; submitted: boolean }) {
  if (submitted) return <Chip color={colors.accent} label="EINGEREICHT" solid />;
  if (c.status === 'voting') return <Chip color="#d3a24a" label="ABSTIMMUNG" />;
  if (c.status === 'closed') return <Chip color={colors.muted} label="BEENDET" />;
  if (c.status === 'full') return <Chip color={colors.muted} label="VOLL" />;
  return <Chip color="#f2696e" label="LIVE" pulse />;
}
function Chip({ color, label, pulse, solid }: { color: string; label: string; pulse?: boolean; solid?: boolean }) {
  return (
    <View style={[styles.chip, solid && { backgroundColor: 'rgba(70,201,138,0.18)' }]}>
      {pulse ? <Pulse color={color} /> : <View style={[styles.chipDot, { backgroundColor: color }]} />}
      <Text style={[styles.chipTxt, { color: solid ? colors.accent : '#fff' }]}>{label}</Text>
    </View>
  );
}
function Pulse({ color }: { color: string }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(p, { toValue: 1, duration: 1000, easing: eases.inout, useNativeDriver: true }),
        Animated.timing(p, { toValue: 0, duration: 1000, easing: eases.inout, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p]);
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          styles.chipDot,
          { position: 'absolute', backgroundColor: color, transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }], opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }) },
        ]}
      />
      <View style={[styles.chipDot, { backgroundColor: color }]} />
    </View>
  );
}
function PulseIf({ on, children }: { on: boolean; children: React.ReactNode }) {
  const p = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on || prefersReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(p, { toValue: 1.03, duration: 700, easing: eases.inout, useNativeDriver: true }),
        Animated.timing(p, { toValue: 1, duration: 700, easing: eases.inout, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, p]);
  return <Animated.View style={{ transform: [{ scale: p }] }}>{children}</Animated.View>;
}

function CountdownChip({ expiresAt, now }: { expiresAt: number; now: number }) {
  const ms = Math.max(0, expiresAt - now);
  const d = Math.floor(ms / 86_400_000);
  const hh = String(Math.floor((ms % 86_400_000) / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  const urgent = ms < 3_600_000 && ms > 0;
  return (
    <View style={styles.cdChip}>
      <Text style={[styles.cdTxt, urgent && { color: '#f2b06d' }]}>
        {ms <= 0 ? 'beendet' : `endet ${d > 0 ? `${d}T ` : ''}${hh}:${mm}:${ss}`}
      </Text>
    </View>
  );
}

/** Ehrlicher Video-Ersatz: langsam wanderndes Muster (kein echtes Video vorhanden). */
function MotionPreview({ hue }: { hue: number }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(Animated.timing(p, { toValue: 1, duration: 9000, easing: eases.inout, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [p]);
  const ty = p.interpolate({ inputRange: [0, 1], outputRange: [0, -40] });
  const tx = p.interpolate({ inputRange: [0, 1], outputRange: [0, 30] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.5, transform: [{ translateX: tx }, { translateY: ty }] }]}>
      <LinearGradient
        colors={[`hsl(${hue} 40% 26%)`, `hsl(${(hue + 40) % 360} 34% 14%)`, 'transparent']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function ScenarioSwitcher({ current }: { current: Scenario }) {
  const opts: { s: Scenario; label: string }[] = [
    { s: 'A', label: 'Normal' },
    { s: 'B', label: 'Slot weg' },
    { s: 'C', label: 'Upload-Fehler' },
    { s: 'D', label: 'Frist endet' },
  ];
  return (
    <View style={styles.scenRow}>
      {opts.map((o) => (
        <AnimatedPressable key={o.s} onPress={() => setScenario(o.s)} haptic="selection" style={[styles.scenChip, current === o.s && styles.scenChipOn]}>
          <Text style={[styles.scenTxt, current === o.s && { color: colors.accentInk }]}>{o.label}</Text>
        </AnimatedPressable>
      ))}
    </View>
  );
}

function FeedSkeleton({ onLayout }: { onLayout: (e: LayoutChangeEvent) => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'flex-end', padding: 20, gap: 12 }} onLayout={onLayout}>
      <View style={[skel, { width: 120, height: 18 }]} />
      <View style={[skel, { width: '70%', height: 30 }]} />
      <View style={[skel, { width: 160, height: 40 }]} />
      <View style={[skel, { width: '90%', height: 50, borderRadius: 14, marginTop: 8 }]} />
    </View>
  );
}

function fmt(ms: number): string {
  const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${mm}:${ss}`;
}
function uploadTitle(st: string): string {
  if (st === 'PROCESSING') return 'Wird geprüft…';
  if (st === 'PAUSED') return 'Pausiert';
  if (st === 'RETRYING') return 'Verbindung verloren';
  if (st === 'FAILED') return 'Upload fehlgeschlagen';
  return 'Deine Einsendung';
}
function uploadHint(st: string): string {
  if (st === 'PROCESSING') return 'Fast fertig — wird verarbeitet';
  if (st === 'PAUSED') return 'Angehalten';
  if (st === 'RETRYING') return 'Setze automatisch fort…';
  if (st === 'FAILED') return 'Dein Video ist gesichert';
  if (st === 'QUEUED') return 'In der Warteschlange';
  return 'Lädt hoch…';
}

const skel = { borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.06)' } as const;
const REC = '#f2696e';
const styles = StyleSheet.create({
  head: { height: HEAD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  scenRow: { flexDirection: 'row', gap: 6 },
  scenChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  scenChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  scenTxt: { fontFamily: fonts.bodySemibold, fontSize: 11, color: colors.muted },
  subCounter: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  subCounterN: { fontFamily: fonts.heading, fontSize: 16, color: colors.accent },
  subCounterL: { fontFamily: fonts.bodySemibold, fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },

  page: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 26, paddingTop: 50, overflow: 'hidden' },
  topRow: { position: 'absolute', top: 14, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.42)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipTxt: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1 },
  cdChip: { backgroundColor: 'rgba(0,0,0,0.42)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  cdTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, color: '#fff', fontVariant: ['tabular-nums'] },

  rail: { position: 'absolute', right: 14, bottom: 220, alignItems: 'center', gap: 18 },
  railBtn: { alignItems: 'center', gap: 5 },
  railIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  railIconOn: { borderColor: colors.accent, backgroundColor: 'rgba(70,201,138,0.16)' },
  railGlyph: { fontSize: 20, color: '#fff' },
  railLabel: { fontFamily: fonts.bodySemibold, fontSize: 11, color: '#fff' },

  content: { gap: 8, maxWidth: '80%' },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  byAv: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  byAvTxt: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  by: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  catPill: { backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  catTxt: { fontFamily: fonts.bodySemibold, fontSize: 11, color: '#fff' },
  title: { fontFamily: fonts.heading, fontSize: 25, color: '#fff', lineHeight: 29 },
  prizeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  prize: { fontFamily: fonts.heading, fontSize: 32, color: colors.accent },
  prizeLabel: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.muted },

  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, alignSelf: 'flex-start', paddingVertical: 4 },
  slotReserved: { backgroundColor: 'rgba(70,201,138,0.14)', borderRadius: 8, paddingHorizontal: 10 },
  slotDot: { width: 7, height: 7, borderRadius: 4 },
  slotStrong: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  slotMuted: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondary: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  secondaryTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  primaryWrap: { flex: 1 },
  primary: { backgroundColor: colors.accent, paddingVertical: 15, borderRadius: 13, alignItems: 'center' },
  primaryTxt: { fontFamily: fonts.heading, fontSize: 15, color: colors.accentInk },
  primaryDone: { backgroundColor: 'rgba(70,201,138,0.16)', borderWidth: 1, borderColor: 'rgba(70,201,138,0.5)' },
  primaryMuted: { backgroundColor: colors.surface2 },

  overlay: { backgroundColor: 'rgba(12,13,16,0.95)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  flowCard: { width: '100%', maxWidth: 380, alignItems: 'center' },
  center: { alignItems: 'center', gap: 14, width: '100%' },
  flowLabel: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.muted },
  flowTitle: { fontFamily: fonts.heading, fontSize: 22, color: colors.text },
  flowHint: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center' },
  flowHintSmall: { fontFamily: fonts.body, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 14 },
  flowPrimary: { backgroundColor: colors.accent, paddingVertical: 15, paddingHorizontal: 40, borderRadius: 13, marginTop: 6 },
  flowPrimaryTxt: { fontFamily: fonts.heading, fontSize: 16, color: colors.accentInk },
  flowGhost: { paddingVertical: 8 },
  flowGhostTxt: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.muted },
  spinner: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: colors.accent, borderTopColor: 'transparent' },
  errBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(242,105,110,0.16)', borderWidth: 2, borderColor: REC, alignItems: 'center', justifyContent: 'center' },
  errBadgeTxt: { fontFamily: fonts.heading, fontSize: 28, color: REC },

  proofOverlay: { position: 'absolute', top: -8, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  proofTxt: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.7)' },
  stopBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(242,105,110,0.14)', borderWidth: 1, borderColor: 'rgba(242,105,110,0.55)', paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13, marginTop: 6 },
  stopInner: { width: 16, height: 16, borderRadius: 4, backgroundColor: REC },
  stopTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },

  upTrack: { height: 10, borderRadius: 999, backgroundColor: colors.bg2, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  upFill: { height: '100%', borderRadius: 999 },
  upRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  upStatus: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
  upPct: { fontFamily: fonts.heading, fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  upActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  upBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 11, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface2 },
  upCancel: { backgroundColor: 'transparent' },
  upBtnTxt: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },

  rules: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  rulesTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.text },
  rulesDesc: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, lineHeight: 20 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontFamily: fonts.heading, fontSize: 14, color: colors.accent },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  stepDesc: { fontFamily: fonts.body, fontSize: 13.5, color: colors.muted },
  rulesBtn: { backgroundColor: colors.accent, paddingVertical: 15, borderRadius: 13, alignItems: 'center', marginTop: 8 },
  rulesBtnTxt: { fontFamily: fonts.heading, fontSize: 16, color: colors.accentInk },
});
