/**
 * Erector Mobile — Welcome Screen
 * Expo Router index route.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <View style={styles.dot} />
        <Text style={styles.badgeText}>PROMPT A1 · SCAFFOLD</Text>
      </View>

      <Text style={styles.title}>Erector</Text>
      <Text style={styles.subtitle}>
        Reality Simulation, Validation & Execution Intelligence Platform.
      </Text>

      <View style={styles.stats}>
        {[['30', 'Economy Types'], ['25', 'DNA Dims'], ['27', 'Engines']].map(([n, l]) => (
          <View key={l} style={styles.statItem}>
            <Text style={styles.statNum}>{n}</Text>
            <Text style={styles.statLabel}>{l}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={styles.btn}
        onPress={() => router.push('/health')}
        testID="view-health-btn"
      >
        <Text style={styles.btnText}>View API Health</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0d',
    padding: 28,
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#22c55e15',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#22c55e33',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  badgeText: { color: '#22c55e', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1 },
  title: {
    fontSize: 52,
    fontWeight: '800',
    color: '#e4f0e8',
    marginBottom: 12,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: '#7a9e85',
    lineHeight: 26,
    marginBottom: 48,
  },
  stats: { flexDirection: 'row', gap: 32, marginBottom: 48 },
  statItem: {},
  statNum: { fontSize: 28, fontWeight: '800', color: '#22c55e' },
  statLabel: { fontSize: 11, color: '#7a9e85', marginTop: 2 },
  btn: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: 'flex-start',
  },
  btnText: { color: '#0a0f0d', fontWeight: '700', fontSize: 14 },
});
