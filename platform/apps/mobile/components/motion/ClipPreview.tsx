import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, fonts } from '../../lib/theme';

/**
 * Echte Wiedergabe des gerade aufgenommenen Clips (loopend, stumm). Wird nur genutzt,
 * wenn tatsächlich eine Clip-URI vorliegt (native Aufnahme via recordAsync). Ohne URI
 * — z. B. im Web-Export ohne Videomitschnitt — rendert der Aufrufer stattdessen den
 * neutralen Platzhalter. So bleibt die Vorschau ehrlich: sie zeigt nur, was es gibt.
 */
export function ClipPreview({ uri, seconds }: { uri: string; seconds: number }) {
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Wiedergabefehler (z. B. Codec nicht abspielbar) sauber abfangen → Platzhalter.
  // Nur der echte 'error'-Status latcht — ein vorübergehender Ladefehler soll einen
  // gültigen Clip nicht dauerhaft ausblenden.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setFailed(true);
      else if (status === 'readyToPlay') setFailed(false);
    });
    return () => sub.remove();
  }, [player]);

  if (failed) {
    return (
      <View style={styles.frame}>
        <Text style={styles.play}>▶</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeTxt}>{seconds > 0 ? `${seconds}s` : 'Clip'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <View style={styles.liveBadge}>
        <View style={styles.dot} />
        <Text style={styles.liveTxt}>Dein Clip</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeTxt}>{seconds > 0 ? `${seconds}s` : 'Clip'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 170,
    height: 240,
    borderRadius: 18,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  play: { fontSize: 40, color: 'rgba(255,255,255,0.7)' },
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  liveTxt: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },
  badge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#fff' },
});
