import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { api, euro, type ChallengeSummary } from '../lib/api';
import { avatarColor, colors, fonts } from '../lib/theme';
import { eases, prefersReducedMotion, springs } from '../lib/motion';
import { haptics } from '../lib/haptics';
import { AnimatedPressable } from '../components/motion/AnimatedPressable';
import { AnimatedCounter } from '../components/motion/AnimatedCounter';
import { AnimatedBottomSheet } from '../components/motion/AnimatedBottomSheet';
import { CountdownRing } from '../components/motion/CountdownRing';
import { RecordingPulse } from '../components/motion/RecordingPulse';
import { UploadProgress, type UploadState } from '../components/motion/UploadProgress';
import { SuccessBurst } from '../components/motion/SuccessBurst';

/** Interaktiver vertikaler Flow:
 *  Feed entdecken → öffnen/Regeln → Teilnahme → Countdown → Aufnahme (simuliert) →
 *  Upload (mit Fehler+Retry) → Einsendung bestätigt. Alle Zustände real; Motion über
 *  die wiederverwendbaren components/motion/*. Aufnahme/Upload sind bewusst simuliert
 *  (Prototyp), Challenge-Daten sind echt. */
export default function PlayScreen() {
  const [items, setItems] = useState<ChallengeSummary[] | null>(null);
  const [h, setH] = useState(0);
  const [active, setActive] = useState(0);

  const load = useCallback(async () => {
    try {
      const list = await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false });
      setItems([...list].sort((a, b) => b.prizeAmountCents - a.prizeAmountCents));
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const onLayout = (e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height);

  if (items === null) return <FeedSkeleton onLayout={onLayout} />;
  if (items.length === 0) return <FeedEmpty />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
      {h > 0 && (
        <ScrollView
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={h}
          decelerationRate="fast"
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / h);
            if (idx !== active) {
              setActive(idx);
              haptics.selection();
            }
          }}
        >
          {items.map((c, i) => (
            <ChallengePage key={c.id} c={c} height={h} isActive={i === active} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Eine Feed-Seite: interaktive Challenge-Karte + Teilnahme-Overlay.   */
/* ------------------------------------------------------------------ */
type Phase = 'idle' | 'joining' | 'joined' | 'countdown' | 'recording' | 'uploading' | 'done';

function ChallengePage({ c, height, isActive }: { c: ChallengeSummary; height: number; isActive: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [rules, setRules] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [recSec, setRecSec] = useState(0);
  const [upPct, setUpPct] = useState(0);
  const [upState, setUpState] = useState<UploadState>('uploading');
  const [failedOnce, setFailedOnce] = useState(false);

  const joined = c.occupiedSlots ?? 0;
  const free = Math.max(0, c.maxSlots - joined);
  const nearlyFull = free <= 2;
  const myPlace = Math.min(c.maxSlots, joined + 1);
  const handle = c.creator?.username ?? 'creator';
  const dots = Array.from({ length: Math.min(joined, 4) }, (_, k) => avatarColor(`${c.id}:${k}`));

  // Karten-Eintritt bei Aktivierung (Fokus).
  const enter = useRef(new Animated.Value(isActive ? 1 : 0.94)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: isActive ? 1 : 0.94, useNativeDriver: true, ...springs.enter }).start();
  }, [isActive, enter]);

  // Overlay-Eintritt (räumlich: skaliert+fadet ein statt hart zu erscheinen).
  const overlay = useRef(new Animated.Value(0)).current;
  const showOverlay = phase !== 'idle';
  useEffect(() => {
    Animated.timing(overlay, {
      toValue: showOverlay ? 1 : 0,
      duration: 260,
      easing: eases.out,
      useNativeDriver: true,
    }).start();
  }, [showOverlay, overlay]);

  function toggleSave() {
    setSaved((v) => !v);
    haptics.selection();
  }

  // Teilnahme starten → Button transformiert in „joining", dann „joined".
  function join() {
    setPhase('joining');
    setTimeout(() => {
      haptics.success();
      setPhase('joined');
    }, 900);
  }

  // Aufnahme (simuliert): Countdown → Recording-Timer → Stop.
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  function startRecording() {
    setRecSec(0);
    setPhase('recording');
    haptics.medium();
    recTimer.current = setInterval(() => setRecSec((s) => s + 1), 1000);
  }
  function stopRecording() {
    if (recTimer.current) clearInterval(recTimer.current);
    haptics.medium();
    beginUpload();
  }

  // Upload (simuliert): Fortschritt, EIN Fehler bei ~60 %, danach Retry bis 100 %.
  const upTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  function beginUpload() {
    setPhase('uploading');
    setUpState('uploading');
    setUpPct(0);
    runUpload(false);
  }
  function runUpload(afterRetry: boolean) {
    if (upTimer.current) clearInterval(upTimer.current);
    upTimer.current = setInterval(() => {
      setUpPct((p) => {
        const next = Math.min(1, p + 0.08);
        // Erster Durchlauf bricht bei ~60 % ab (Fehlerzustand + Wiederherstellung).
        if (!afterRetry && !failedOnce && next >= 0.6) {
          if (upTimer.current) clearInterval(upTimer.current);
          setFailedOnce(true);
          setUpState('error');
          haptics.error();
          return 0.6;
        }
        if (next >= 1) {
          if (upTimer.current) clearInterval(upTimer.current);
          setUpState('done');
          haptics.success();
          setTimeout(() => setPhase('done'), 350);
        }
        return next;
      });
    }, 180);
  }
  function retryUpload() {
    setUpState('uploading');
    runUpload(true);
  }

  useEffect(
    () => () => {
      if (recTimer.current) clearInterval(recTimer.current);
      if (upTimer.current) clearInterval(upTimer.current);
    },
    [],
  );

  const bg = feedTint(c.id);

  return (
    <View style={{ height, width: '100%' }}>
      <Animated.View style={[styles.page, { transform: [{ scale: enter }], opacity: isActive ? 1 : 0.85 }]}>
        {/* Hintergrund (dezenter Farbton je Challenge) + Lesbarkeits-Verlauf */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
        <LinearGradient
          colors={['transparent', 'rgba(12,13,16,0.86)']}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Live-Chip oben */}
        <View style={styles.topRow}>
          <View style={styles.liveChip}>
            <LivePulse />
            <Text style={styles.liveTxt}>LIVE</Text>
          </View>
          <CountdownChip iso={c.submissionDeadline} />
        </View>

        {/* Rechte Aktionsleiste */}
        <View style={styles.rail}>
          <AnimatedPressable onPress={toggleSave} haptic="none" style={styles.railBtn}>
            <View style={[styles.railIcon, saved && { borderColor: colors.accent, backgroundColor: 'rgba(70,201,138,0.14)' }]}>
              <Text style={[styles.railGlyph, saved && { color: colors.accent }]}>{saved ? '★' : '☆'}</Text>
            </View>
            <Text style={styles.railLabel}>{saved ? 'Gemerkt' : 'Merken'}</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={() => router.push(`/challenge/${c.id}`)} style={styles.railBtn}>
            <View style={styles.railIcon}>
              <Text style={styles.railGlyph}>💬</Text>
            </View>
            <Text style={styles.railLabel}>{c.commentCount ?? 0}</Text>
          </AnimatedPressable>
        </View>

        {/* Inhalt unten */}
        <View style={styles.content}>
          <Text style={styles.by}>@{handle}</Text>
          <Text style={styles.title}>{c.title || 'Ohne Titel'}</Text>

          <View style={styles.prizeRow}>
            <AnimatedCounter
              value={isActive ? Math.round(c.prizeAmountCents / 100) : 0}
              format={(n) => euro(n * 100)}
              style={styles.prize}
            />
            <Text style={styles.prizeLabel}>Preisgeld</Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.avatars}>
              {dots.map((col, k) => (
                <View key={k} style={[styles.av, { backgroundColor: col, zIndex: 4 - k }]} />
              ))}
            </View>
            {joined > 0 ? (
              <Text style={styles.meta}>
                <AnimatedCounter value={isActive ? joined : 0} style={styles.metaStrong} /> dabei ·{' '}
                <Text style={nearlyFull ? styles.metaHot : undefined}>{free} frei</Text>
              </Text>
            ) : (
              <Text style={styles.meta}>Sei die/der Erste · {free} frei</Text>
            )}
          </View>

          <View style={styles.actions}>
            <AnimatedPressable onPress={() => setRules(true)} haptic="light" style={styles.secondary}>
              <Text style={styles.secondaryTxt}>Regeln</Text>
            </AnimatedPressable>
            <AnimatedPressable onPress={join} haptic="medium" pressScale={0.97} style={styles.primaryWrap}>
              <View style={styles.primary}>
                <Text style={styles.primaryTxt}>Mitmachen</Text>
              </View>
            </AnimatedPressable>
          </View>
        </View>
      </Animated.View>

      {/* Regeln als ziehbares Bottom-Sheet */}
      <AnimatedBottomSheet open={rules} onClose={() => setRules(false)}>
        <RulesContent c={c} onClose={() => setRules(false)} />
      </AnimatedBottomSheet>

      {/* Teilnahme-Overlay (räumlicher Eintritt) */}
      {showOverlay && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.overlay,
            {
              opacity: overlay,
              transform: [{ scale: overlay.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
            },
          ]}
        >
          <ParticipationFlow
            phase={phase}
            place={myPlace}
            max={c.maxSlots}
            recSec={recSec}
            upPct={upPct}
            upState={upState}
            onArm={() => setPhase('countdown')}
            onRecord={startRecording}
            onStop={stopRecording}
            onRetry={retryUpload}
            onDone={() => router.replace('/')}
            onCancel={() => setPhase('idle')}
          />
        </Animated.View>
      )}
    </View>
  );
}

/* --------------------------- Teilnahme-Flow --------------------------- */
function ParticipationFlow({
  phase,
  place,
  max,
  recSec,
  upPct,
  upState,
  onArm,
  onRecord,
  onStop,
  onRetry,
  onDone,
  onCancel,
}: {
  phase: Phase;
  place: number;
  max: number;
  recSec: number;
  upPct: number;
  upState: UploadState;
  onArm: () => void;
  onRecord: () => void;
  onStop: () => void;
  onRetry: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.flowCard}>
      {phase === 'joining' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.flowLabel}>Sichere deinen Platz…</Text>
        </View>
      )}

      {phase === 'joined' && (
        <View style={styles.center}>
          <SuccessBurst title="Du bist drin." subtitle={`Platz ${place} von ${max} gehört dir.`} />
          <AnimatedPressable onPress={onArm} haptic="medium" style={styles.flowPrimary}>
            <Text style={styles.flowPrimaryTxt}>Jetzt aufnehmen</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={onCancel} haptic="none" style={styles.flowGhost}>
            <Text style={styles.flowGhostTxt}>Später</Text>
          </AnimatedPressable>
        </View>
      )}

      {phase === 'countdown' && <CountdownRing from={3} onDone={onRecord} />}

      {phase === 'recording' && (
        <View style={styles.center}>
          <RecordingPulse seconds={recSec} />
          <Text style={styles.flowHint}>Nimm deinen Beweis auf — direkt in der App.</Text>
          <AnimatedPressable onPress={onStop} haptic="medium" style={styles.stopBtn}>
            <View style={styles.stopInner} />
            <Text style={styles.stopTxt}>Stoppen &amp; einsenden</Text>
          </AnimatedPressable>
        </View>
      )}

      {phase === 'uploading' && (
        <View style={styles.center}>
          <Text style={styles.flowTitle}>Deine Einsendung</Text>
          <View style={{ width: '100%', marginTop: 18 }}>
            <UploadProgress progress={upPct} state={upState} onRetry={onRetry} />
          </View>
          <Text style={styles.flowHintSmall}>Du kannst die App normal weiter nutzen.</Text>
        </View>
      )}

      {phase === 'done' && (
        <View style={styles.center}>
          <SuccessBurst title="Eingereicht." subtitle="Und jetzt? Daumen drücken — die Community entscheidet." />
          <AnimatedPressable onPress={onDone} haptic="selection" style={styles.flowPrimary}>
            <Text style={styles.flowPrimaryTxt}>Zum Feed</Text>
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

/* --------------------------- Regeln-Inhalt --------------------------- */
function RulesContent({ c, onClose }: { c: ChallengeSummary; onClose: () => void }) {
  const steps = [
    { n: '1', t: 'Mitmachen', d: `Sichere dir einen von ${c.maxSlots} Plätzen.` },
    { n: '2', t: 'In der App aufnehmen', d: 'Kein Galerie-Import, kein Schnitt — echt.' },
    { n: '3', t: 'Community entscheidet', d: 'Die beste Einsendung gewinnt das Preisgeld.' },
  ];
  return (
    <View style={styles.rules}>
      <Text style={styles.rulesTitle}>So läufst du mit</Text>
      {c.description ? <Text style={styles.rulesDesc}>{c.description}</Text> : null}
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
      <AnimatedPressable onPress={onClose} haptic="medium" style={styles.rulesBtn}>
        <Text style={styles.rulesBtnTxt}>Verstanden</Text>
      </AnimatedPressable>
    </View>
  );
}

/* --------------------------- kleine Teile --------------------------- */
function LivePulse() {
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
  const scale = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const opacity = p.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.livePulse, { transform: [{ scale }], opacity }]} />
      <View style={styles.liveDot} />
    </View>
  );
}

function CountdownChip({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const hh = String(Math.floor((ms % 86_400_000) / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return (
    <View style={styles.cdChip}>
      <Text style={styles.cdTxt}>
        endet in {d > 0 ? `${d}T ` : ''}
        {hh}:{mm}:{ss}
      </Text>
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
function FeedEmpty() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 }}>
      <Text style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, textAlign: 'center' }}>Noch ruhig hier.</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: 'center' }}>
        Starte die erste Challenge und setz ein Preisgeld aus.
      </Text>
      <AnimatedPressable onPress={() => router.push('/create')} haptic="medium" style={styles.flowPrimary}>
        <Text style={styles.flowPrimaryTxt}>Challenge starten</Text>
      </AnimatedPressable>
    </View>
  );
}

function feedTint(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${n} 22% 17%)`;
}

const skel = {
  borderRadius: 9,
  backgroundColor: 'rgba(255,255,255,0.06)',
} as const;

const REC = '#f2696e';
const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 30, paddingTop: 54 },
  topRow: { position: 'absolute', top: 16, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  livePulse: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: REC },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: REC },
  liveTxt: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: '#fff' },
  cdChip: { backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  cdTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, color: '#fff', fontVariant: ['tabular-nums'] },

  rail: { position: 'absolute', right: 14, bottom: 200, alignItems: 'center', gap: 18 },
  railBtn: { alignItems: 'center', gap: 5 },
  railIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railGlyph: { fontSize: 20, color: '#fff' },
  railLabel: { fontFamily: fonts.bodySemibold, fontSize: 11, color: '#fff' },

  content: { gap: 8, maxWidth: '82%' },
  by: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  title: { fontFamily: fonts.heading, fontSize: 26, color: '#fff', lineHeight: 30 },
  prizeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  prize: { fontFamily: fonts.heading, fontSize: 32, color: colors.accent },
  prizeLabel: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  avatars: { flexDirection: 'row' },
  av: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.bg, marginLeft: -8 },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  metaStrong: { fontFamily: fonts.bodyBold, color: '#fff' },
  metaHot: { fontFamily: fonts.bodyBold, color: colors.accent },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondary: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  secondaryTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  primaryWrap: { flex: 1 },
  primary: { backgroundColor: colors.accent, paddingVertical: 15, borderRadius: 13, alignItems: 'center' },
  primaryTxt: { fontFamily: fonts.heading, fontSize: 16, color: colors.accentInk },

  overlay: { backgroundColor: 'rgba(12,13,16,0.94)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  flowCard: { width: '100%', maxWidth: 380, alignItems: 'center' },
  center: { alignItems: 'center', gap: 14, width: '100%' },
  flowLabel: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.muted },
  flowTitle: { fontFamily: fonts.heading, fontSize: 22, color: colors.text },
  flowHint: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center' },
  flowHintSmall: { fontFamily: fonts.body, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 12 },
  flowPrimary: { backgroundColor: colors.accent, paddingVertical: 15, paddingHorizontal: 40, borderRadius: 13, marginTop: 8 },
  flowPrimaryTxt: { fontFamily: fonts.heading, fontSize: 16, color: colors.accentInk },
  flowGhost: { paddingVertical: 10 },
  flowGhostTxt: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.muted },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(242,105,110,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(242,105,110,0.55)',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 13,
    marginTop: 6,
  },
  stopInner: { width: 16, height: 16, borderRadius: 4, backgroundColor: REC },
  stopTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },

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
