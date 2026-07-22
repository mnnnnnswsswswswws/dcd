import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EvidenceCamera } from '../../components/EvidenceCamera';
import { Badge, Button, Card, ErrorText, Muted, Row, StatusBadge } from '../../components/ui';
import {
  api,
  euro,
  selectionModeLabel,
  type ChallengeDetail,
  type MyChallenges,
  type PublicConfig,
  type SubmissionRow,
} from '../../lib/api';
import { useSession } from '../../lib/session';
import { colors, fonts } from '../../lib/theme';

const TERMINAL = new Set(['WINNER_LOCKED', 'PAID_OUT', 'CANCELLED', 'EXPIRED']);
const SELECTABLE = new Set(['SUBMISSIONS_CLOSED', 'IN_REVIEW', 'SELECTION']);

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, userId } = useSession();

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [slotStatus, setSlotStatus] = useState<string | null>(null);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [selectedWinner, setSelectedWinner] = useState('');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setChallenge(await api<ChallengeDetail>(`/v1/challenges/${id}`, { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    }
    try {
      const cfg = await api<PublicConfig>('/v1/config', { auth: false });
      setCaptureEnabled(cfg.longCaptureEnabled);
    } catch {
      setCaptureEnabled(false);
    }
    if (token) {
      try {
        setSubs(await api<SubmissionRow[]>(`/v1/challenges/${id}/submissions`));
      } catch {
        setSubs([]);
      }
      try {
        const mine = await api<MyChallenges>('/v1/users/me/challenges');
        const joined = mine.joined.find((c) => c.id === id);
        setSlotStatus(joined ? joined.slotStatus : null);
      } catch {
        setSlotStatus(null);
      }
    } else {
      setSubs([]);
      setSlotStatus(null);
    }
    setLoading(false);
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function act(label: string, run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(`${label} ✓`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!challenge) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <ErrorText>Fehler: {error}</ErrorText> : <Muted>Lädt…</Muted>}
      </ScrollView>
    );
  }

  const loggedIn = Boolean(token);
  const isCreator = loggedIn && userId === challenge.creatorId;
  const status = challenge.status;
  const isOpen = status === 'OPEN' || status === 'FULL';
  const isVote = challenge.selectionMode === 'COMMUNITY_VOTE';
  const isTerminal = TERMINAL.has(status);
  const mySubmission = subs.find((s) => s.participantId === userId);

  const canJoin = loggedIn && !isCreator && isOpen && !slotStatus;
  const canSubmit = loggedIn && Boolean(slotStatus) && !mySubmission?.finalizedAt;
  const canClose = isCreator && isOpen;
  const canDecide = isCreator && SELECTABLE.has(status) && (isVote || Boolean(selectedWinner));
  const canCancel = isCreator && !isTerminal && status !== 'PAID_OUT';
  const slotPct = Math.round((challenge.occupiedSlots / challenge.maxSlots) * 100);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {error && <ErrorText>Fehler: {error}</ErrorText>}
      {note && <Muted>{note}</Muted>}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.title}>{challenge.title || 'Ohne Titel'}</Text>
          <Text style={styles.prize}>{euro(challenge.prizeAmountCents)}</Text>
        </Row>
        <Row>
          <StatusBadge status={status} />
          {challenge.category ? <Badge label={challenge.category} /> : null}
          <Badge label={selectionModeLabel(challenge.selectionMode)} />
          {isCreator ? <Badge label="Deine Challenge" /> : null}
        </Row>
        {challenge.description ? <Text style={styles.body}>{challenge.description}</Text> : null}

        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>Teilnehmerplätze</Muted>
          <Muted>
            {challenge.occupiedSlots}/{challenge.maxSlots}
          </Muted>
        </Row>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${slotPct}%` }]} />
        </View>

        {challenge.criteria.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Kriterien</Text>
            {challenge.criteria.map((c) => (
              <Text key={c.id} style={styles.body}>
                • {c.title}
                {!c.mandatory ? ' (optional)' : ''}
              </Text>
            ))}
          </View>
        )}

        {challenge.winner && (
          <Muted>Gewinner steht fest — ermittelt durch {selectionModeLabel(challenge.selectionMode)}.</Muted>
        )}
      </Card>

      {!loggedIn && <Muted>Zum Mitmachen auf der Startseite registrieren (18+).</Muted>}

      {loggedIn && !isCreator && (
        <Card>
          <Text style={styles.sectionLabel}>Teilnehmen</Text>
          {slotStatus ? (
            <Muted>
              Dein Platz ist reserviert (Status: {slotStatus}).
              {mySubmission ? ` Deine Einsendung ist ${mySubmission.status}.` : ' Reiche jetzt deinen In-App-Beweis ein.'}
            </Muted>
          ) : (
            <Muted>{isOpen ? 'Sichere dir einen der max. 10 Plätze.' : 'Keine neuen Teilnehmer mehr.'}</Muted>
          )}
          <Row>
            <Button title="Beitreten" variant="primary" disabled={busy || !canJoin} onPress={() => act('Beigetreten', () => api(`/v1/challenges/${id}/join`, { method: 'POST' }))} />
            <Button
              title="Beweis einreichen"
              disabled={busy || !canSubmit || recording}
              onPress={() => {
                if (captureEnabled) setRecording(true);
                else void act('Eingereicht', () => api(`/v1/challenges/${id}/submit`, { method: 'POST' }));
              }}
            />
          </Row>
          <Muted>Beweise werden ausschließlich in der App aufgenommen — kein Galerie-Import, kein Schnitt.</Muted>
        </Card>
      )}

      {recording && (
        <EvidenceCamera
          challengeId={id}
          onSubmitted={() => {
            setRecording(false);
            setNote('Eingereicht ✓');
            void load();
          }}
          onCancel={() => setRecording(false)}
        />
      )}

      {isCreator && (
        <Card>
          <Text style={styles.sectionLabel}>Verwaltung</Text>
          <Muted>
            {isVote ? 'Der Gewinner ergibt sich aus den Community-Stimmen.' : 'Wähle den Gewinner unter den freigegebenen Einsendungen.'}{' '}
            Moderation und Auszahlung erfolgen im Admin-Bereich.
          </Muted>
          <Row>
            <Button title="Einsendeschluss" disabled={busy || !canClose} onPress={() => act('Einsendeschluss gesetzt', () => api(`/v1/challenges/${id}/close`, { method: 'POST' }))} />
            <Button
              title={isVote ? 'Gewinner ermitteln' : 'Gewinner festlegen'}
              variant="primary"
              disabled={busy || !canDecide}
              onPress={() =>
                act('Gewinner festgelegt', () =>
                  api(`/v1/challenges/${id}/select-winner`, {
                    method: 'POST',
                    body: { winnerSubmissionId: isVote ? undefined : selectedWinner || undefined },
                  }),
                )
              }
            />
            <Button title="Abbrechen" variant="danger" disabled={busy || !canCancel} onPress={() => act('Abgebrochen', () => api(`/v1/challenges/${id}/cancel`, { method: 'POST' }))} />
          </Row>
        </Card>
      )}

      <Text style={styles.h2}>Einsendungen</Text>
      {!loggedIn && <Muted>Melde dich an, um Einsendungen zu sehen und abzustimmen.</Muted>}
      {loggedIn && subs.length === 0 && <Muted>Noch keine Einsendungen.</Muted>}

      {subs.map((s) => {
        const mine = s.participantId === userId;
        const canVote = isVote && loggedIn && !isTerminal && s.status === 'APPROVED';
        const canPick = isCreator && !isVote && s.status === 'APPROVED' && SELECTABLE.has(status);
        const picked = selectedWinner === s.id;
        return (
          <Card key={s.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.body}>
                Teilnehmer {s.participantId.slice(0, 8)}…{mine ? ' (du)' : ''}
              </Text>
              <Badge label={s.status} />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>
                {s.voteCount} {s.voteCount === 1 ? 'Stimme' : 'Stimmen'}
              </Muted>
              <Row>
                {canPick && (
                  <Button title={picked ? '✓ Gewinner' : 'Als Gewinner'} variant={picked ? 'primary' : 'ghost'} onPress={() => setSelectedWinner(picked ? '' : s.id)} />
                )}
                {isVote && (
                  <Button title="Abstimmen" disabled={busy || !canVote} onPress={() => act('Abgestimmt', () => api(`/v1/challenges/${id}/vote`, { method: 'POST', body: { submissionId: s.id } }))} />
                )}
                {loggedIn && !mine && <ReportButton challengeId={id} submissionId={s.id} onDone={() => setNote('Gemeldet ✓')} />}
              </Row>
            </Row>
          </Card>
        );
      })}
    </ScrollView>
  );
}

function ReportButton({ submissionId, onDone }: { challengeId: string; submissionId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function report() {
    setBusy(true);
    try {
      await api('/v1/reports', { method: 'POST', body: { targetType: 'SUBMISSION', targetId: submissionId, reason: 'OTHER' } });
      setDone(true);
      onDone();
    } catch {
      // Fehler still — Melden ist unkritisch.
    } finally {
      setBusy(false);
    }
  }
  if (done) return <Muted>Gemeldet</Muted>;
  return <Button title="Melden" disabled={busy} onPress={report} />;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontFamily: fonts.heading, color: colors.text, flexShrink: 1 },
  prize: { fontSize: 18, fontFamily: fonts.heading, color: colors.green },
  body: { color: colors.text, fontSize: 14, fontFamily: fonts.body },
  sectionLabel: { fontSize: 16, fontFamily: fonts.heading, color: colors.text },
  h2: { fontSize: 19, fontFamily: fonts.heading, color: colors.text, marginVertical: 10 },
  progress: { height: 8, borderRadius: 999, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
});
