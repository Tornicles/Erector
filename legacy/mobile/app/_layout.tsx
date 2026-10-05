/**
 * Expo Router root layout.
 * Defines tab navigation structure for the Erector mobile app.
 */
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0f0d' },
        headerTintColor: '#e4f0e8',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: '#0a0f0d' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Erector' }} />
      <Stack.Screen name="health" options={{ title: 'API Health' }} />
    </Stack>
  );
}
