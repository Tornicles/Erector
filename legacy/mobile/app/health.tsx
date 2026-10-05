/**
 * Erector Mobile — Health Screen
 * Shows live API health from the backend.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8001';

interface HealthData {
  status: string;
  version: string;
  environment: string;
  database: { connected: boolean; name: string | null };
  mock_auth_enabled: boolean;
}

export default function HealthScreen() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/health`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError('API returned an error.');
      }
    } catch (e) {
      setError('Could not reach the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const statusColor = data?.status === 'healthy' ? '#22c55e' : '#eab308';

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#22c55e" />}
      testID="health-screen"
    >
      <Text style={styles.heading}>API Health</Text>

      {loading && !data && (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 32 }} />
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {data && (
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor, shadowColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>
              {data.status.toUpperCase()}
            </Text>
          </View>

          {[
            ['Version', data.version],
            ['Environment', data.environment],
            ['Database', data.database.connected ? `Connected · ${data.database.name}` : 'Disconnected'],
            ['Mock Auth', data.mock_auth_enabled ? 'Enabled (dev)' : 'Supabase'],
          ].map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowValue}>{value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Endpoint list */}
      <View style={styles.endpointBox}>
        <Text style={styles.endpointHeading}>A1 ENDPOINTS</Text>
        {[
          ['GET', '/api/health'],
          ['POST', '/api/v1/auth/magic-link'],
          ['GET', '/api/v1/auth/verify'],
          ['POST', '/api/v1/auth/refresh'],
          ['POST', '/api/v1/auth/logout'],
          ['GET', '/api/v1/auth/me'],
        ].map(([method, path]) => (
          <View key={path} style={styles.endpointRow}>
            <Text style={[styles.method, { color: method === 'GET' ? '#22c55e' : '#3b82f6' }]}>
              {method}
            </Text>
            <Text style={styles.path}>{path}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f0d', padding: 24 },
  heading: { fontSize: 26, fontWeight: '700', color: '#e4f0e8', marginBottom: 24 },
  card: {
    backgroundColor: '#152019',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e3528',
    marginBottom: 24,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  statusDot: { width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.6, shadowRadius: 6 },
  statusLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  rowLabel: { color: '#7a9e85', fontSize: 13 },
  rowValue: { color: '#e4f0e8', fontSize: 13, fontFamily: 'monospace' },
  endpointBox: {
    backgroundColor: '#152019',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e3528',
  },
  endpointHeading: { color: '#7a9e85', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 12 },
  endpointRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  method: { width: 36, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' },
  path: { color: '#7a9e85', fontSize: 12, fontFamily: 'monospace' },
  errorBox: {
    backgroundColor: '#ef444420',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ef444440',
    marginTop: 16,
  },
  errorText: { color: '#ef4444', fontSize: 14 },
});
